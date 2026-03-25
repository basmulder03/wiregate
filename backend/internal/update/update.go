// Package update handles version checking and self-updating for WireGate.
package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	repoOwner = "basmulder03"
	repoName  = "wiregate"
	apiURL    = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases/latest"
)

// InstallMethod describes how WireGate was installed / is managed.
type InstallMethod string

const (
	InstallMethodSystemd InstallMethod = "systemd"
	InstallMethodLaunchd InstallMethod = "launchd"
	InstallMethodDocker  InstallMethod = "docker"
	InstallMethodManual  InstallMethod = "manual"
)

// ReleaseInfo holds information about a GitHub release.
type ReleaseInfo struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	PublishedAt time.Time `json:"published_at"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
}

// DetectInstallMethod returns how this process is being managed.
func DetectInstallMethod() InstallMethod {
	// Docker: /.dockerenv exists or running as PID 1 inside a container
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return InstallMethodDocker
	}

	// systemd: INVOCATION_ID is set by systemd for every managed service unit
	if os.Getenv("INVOCATION_ID") != "" {
		return InstallMethodSystemd
	}

	// launchd: LAUNCHD_SOCKET is set by launchd
	if os.Getenv("LAUNCHD_SOCKET") != "" {
		return InstallMethodLaunchd
	}

	// Also try reading /proc/1/comm on Linux (init process name)
	if runtime.GOOS == "linux" {
		if comm, err := os.ReadFile("/proc/1/comm"); err == nil {
			if strings.TrimSpace(string(comm)) == "systemd" {
				// System is managed by systemd but we may be in a user session;
				// only claim systemd if we can also talk to the unit.
				if _, err := exec.LookPath("systemctl"); err == nil {
					return InstallMethodSystemd
				}
			}
		}
	}

	return InstallMethodManual
}

// FetchLatestRelease queries the GitHub API and returns the latest release info.
func FetchLatestRelease() (*ReleaseInfo, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("github api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("github api rate limit exceeded")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned %d", resp.StatusCode)
	}

	var release ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to decode release info: %w", err)
	}
	return &release, nil
}

// IsNewer returns true when latestTag is strictly newer than currentVersion.
// Both are expected to be semver strings, optionally prefixed with "v".
func IsNewer(currentVersion, latestTag string) bool {
	cv := strings.TrimPrefix(strings.TrimSpace(currentVersion), "v")
	lv := strings.TrimPrefix(strings.TrimSpace(latestTag), "v")
	if cv == "dev" || cv == "" {
		return false // dev builds are never "outdated"
	}
	return lv != cv && semverGT(lv, cv)
}

// semverGT returns true when a > b (simple 3-part comparison).
func semverGT(a, b string) bool {
	pa := parseSemver(a)
	pb := parseSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] > pb[i] {
			return true
		}
		if pa[i] < pb[i] {
			return false
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	var parts [3]int
	segments := strings.SplitN(v, ".", 3)
	for i, s := range segments {
		if i >= 3 {
			break
		}
		// strip any pre-release suffix
		s = strings.SplitN(s, "-", 2)[0]
		fmt.Sscanf(s, "%d", &parts[i])
	}
	return parts
}

// PerformUpdate downloads the latest release binary for the current platform,
// replaces the running executable, and then restarts the service according to
// the detected install method. It returns an error if anything fails before
// the replacement completes; once the replacement is done it calls restart()
// asynchronously and returns nil.
func PerformUpdate(latestTag string, method InstallMethod) error {
	binaryURL := buildBinaryURL(latestTag)
	log.Printf("update: downloading %s", binaryURL)

	tmp, err := os.MkdirTemp("", "wiregate-update-*")
	if err != nil {
		return fmt.Errorf("update: cannot create temp dir: %w", err)
	}
	defer os.RemoveAll(tmp)

	archivePath := filepath.Join(tmp, "wiregate-release"+archiveExt())
	if err := downloadFile(binaryURL, archivePath); err != nil {
		return fmt.Errorf("update: download failed: %w", err)
	}

	newBinary := filepath.Join(tmp, "wiregate-new")
	if err := extractBinary(archivePath, newBinary); err != nil {
		return fmt.Errorf("update: extract failed: %w", err)
	}
	if err := os.Chmod(newBinary, 0755); err != nil {
		return fmt.Errorf("update: chmod failed: %w", err)
	}

	// Replace the running binary
	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("update: cannot resolve executable path: %w", err)
	}
	self, _ = filepath.EvalSymlinks(self)

	backup := self + ".bak"
	_ = os.Rename(self, backup)
	if err := copyFile(newBinary, self); err != nil {
		// Try to roll back
		_ = os.Rename(backup, self)
		return fmt.Errorf("update: cannot replace binary: %w", err)
	}
	_ = os.Remove(backup)

	log.Printf("update: binary replaced at %s; initiating restart via %s", self, method)

	go func() {
		time.Sleep(500 * time.Millisecond) // give the HTTP response time to flush
		restartProcess(method)
	}()

	return nil
}

func buildBinaryURL(tag string) string {
	os_ := runtime.GOOS
	arch := runtime.GOARCH
	version := strings.TrimPrefix(tag, "v")
	archiveFilename := fmt.Sprintf("wiregate_%s_%s_%s%s", version, os_, arch, archiveExt())
	return fmt.Sprintf("https://github.com/%s/%s/releases/download/%s/%s",
		repoOwner, repoName, tag, archiveFilename)
}

func archiveExt() string {
	if runtime.GOOS == "windows" {
		return ".zip"
	}
	return ".tar.gz"
}

func downloadFile(url, dest string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func extractBinary(archivePath, destPath string) error {
	if strings.HasSuffix(archivePath, ".zip") {
		return extractFromZip(archivePath, destPath)
	}
	return extractFromTarGz(archivePath, destPath)
}

func extractFromTarGz(archivePath, destPath string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Base(hdr.Name)
		if name == "wiregate" || name == "wiregate.exe" {
			out, err := os.Create(destPath)
			if err != nil {
				return err
			}
			defer out.Close()
			_, err = io.Copy(out, tr)
			return err
		}
	}
	return fmt.Errorf("wiregate binary not found in archive")
}

func extractFromZip(archivePath, destPath string) error {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if name == "wiregate" || name == "wiregate.exe" {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			defer rc.Close()
			out, err := os.Create(destPath)
			if err != nil {
				return err
			}
			defer out.Close()
			_, err = io.Copy(out, rc)
			return err
		}
	}
	return fmt.Errorf("wiregate binary not found in zip")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func restartProcess(method InstallMethod) {
	switch method {
	case InstallMethodSystemd:
		log.Println("update: restarting via systemctl restart wiregate")
		cmd := exec.Command("systemctl", "restart", "wiregate")
		if err := cmd.Run(); err != nil {
			log.Printf("update: systemctl restart failed: %v — falling back to os.Exit", err)
			os.Exit(0)
		}
	case InstallMethodLaunchd:
		log.Println("update: restarting via launchctl kickstart")
		// launchd KeepAlive=true will restart the process when it exits
		os.Exit(0)
	default:
		// Docker / manual: just exit — the container runtime or user will restart
		log.Println("update: exiting process for external restart")
		os.Exit(0)
	}
}
