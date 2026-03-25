package api

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/basmulder03/wiregate/internal/models"
)

type auditExpr interface {
	Eval(log models.AuditLog) bool
}

type auditCondition struct {
	field string
	value string
}

type auditAnd struct {
	left  auditExpr
	right auditExpr
}

type auditOr struct {
	left  auditExpr
	right auditExpr
}

type auditNot struct {
	expr auditExpr
}

func (c auditCondition) Eval(log models.AuditLog) bool {
	field := strings.ToLower(c.field)
	value := strings.TrimSpace(c.value)
	if value == "" {
		return true
	}

	switch field {
	case "", "text":
		needle := strings.ToLower(value)
		return strings.Contains(strings.ToLower(log.Username), needle) ||
			strings.Contains(strings.ToLower(log.Action), needle) ||
			strings.Contains(strings.ToLower(log.Resource), needle) ||
			strings.Contains(strings.ToLower(log.Details), needle) ||
			strings.Contains(strings.ToLower(log.IPAddress), needle) ||
			strings.Contains(strings.ToLower(boolLabel(log.Success)), needle)
	case "user", "username":
		return containsFold(log.Username, value)
	case "action":
		return containsFold(log.Action, value)
	case "resource":
		return containsFold(log.Resource, value)
	case "ip":
		return matchIP(log.IPAddress, value)
	case "status":
		status := strings.ToLower(value)
		if status == "success" || status == "ok" || status == "true" {
			return log.Success
		}
		if status == "failed" || status == "error" || status == "false" {
			return !log.Success
		}
		return false
	case "time", "created", "created_at":
		return matchTime(log.CreatedAt, value)
	default:
		return false
	}
}

func (e auditAnd) Eval(log models.AuditLog) bool { return e.left.Eval(log) && e.right.Eval(log) }
func (e auditOr) Eval(log models.AuditLog) bool  { return e.left.Eval(log) || e.right.Eval(log) }
func (e auditNot) Eval(log models.AuditLog) bool { return !e.expr.Eval(log) }

func containsFold(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func boolLabel(v bool) string {
	if v {
		return "success"
	}
	return "failed"
}

func matchIP(actual, query string) bool {
	actual = strings.TrimSpace(actual)
	query = strings.TrimSpace(query)
	if actual == "" || query == "" {
		return false
	}

	if strings.Contains(query, "/") {
		ip := net.ParseIP(actual)
		_, cidr, err := net.ParseCIDR(query)
		return err == nil && ip != nil && cidr.Contains(ip)
	}

	return containsFold(actual, query)
}

func matchTime(actual time.Time, query string) bool {
	query = strings.TrimSpace(query)
	if query == "" {
		return true
	}

	op := "="
	for _, candidate := range []string{">=", "<=", ">", "<", "="} {
		if strings.HasPrefix(query, candidate) {
			op = candidate
			query = strings.TrimSpace(strings.TrimPrefix(query, candidate))
			break
		}
	}

	parsed, err := parseAuditTime(query)
	if err != nil {
		return false
	}

	switch op {
	case ">":
		return actual.After(parsed)
	case ">=":
		return actual.After(parsed) || actual.Equal(parsed)
	case "<":
		return actual.Before(parsed)
	case "<=":
		return actual.Before(parsed) || actual.Equal(parsed)
	default:
		return actual.Equal(parsed)
	}
}

func parseAuditTime(value string) (time.Time, error) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid time: %s", value)
}

func tokenizeAuditQuery(input string) []string {
	var tokens []string
	var current strings.Builder
	var quote rune

	flush := func() {
		if current.Len() == 0 {
			return
		}
		tokens = append(tokens, current.String())
		current.Reset()
	}

	for _, r := range input {
		switch {
		case quote != 0:
			current.WriteRune(r)
			if r == quote {
				quote = 0
			}
		case r == '\'' || r == '"':
			quote = r
			current.WriteRune(r)
		case r == '(' || r == ')':
			flush()
			tokens = append(tokens, string(r))
		case r == ' ' || r == '\t' || r == '\n':
			flush()
		default:
			current.WriteRune(r)
		}
	}
	flush()
	return tokens
}

type auditParser struct {
	tokens []string
	pos    int
}

func parseAuditExpr(input string) (auditExpr, error) {
	tokens := tokenizeAuditQuery(input)
	if len(tokens) == 0 {
		return nil, nil
	}
	p := &auditParser{tokens: tokens}
	expr, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.pos < len(p.tokens) {
		return nil, fmt.Errorf("unexpected token: %s", p.tokens[p.pos])
	}
	return expr, nil
}

func (p *auditParser) parseOr() (auditExpr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.matchKeyword("OR") {
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = auditOr{left: left, right: right}
	}
	return left, nil
}

func (p *auditParser) parseAnd() (auditExpr, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		if p.matchKeyword("AND") {
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			left = auditAnd{left: left, right: right}
			continue
		}
		if p.peek() != "" && !p.peekKeyword("OR") && p.peek() != ")" {
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			left = auditAnd{left: left, right: right}
			continue
		}
		break
	}
	return left, nil
}

func (p *auditParser) parseUnary() (auditExpr, error) {
	if p.matchKeyword("NOT") {
		expr, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return auditNot{expr: expr}, nil
	}
	return p.parsePrimary()
}

func (p *auditParser) parsePrimary() (auditExpr, error) {
	if p.match("(") {
		expr, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if !p.match(")") {
			return nil, fmt.Errorf("missing closing parenthesis")
		}
		return expr, nil
	}

	token := p.next()
	if token == "" {
		return nil, fmt.Errorf("expected expression")
	}
	return parseAuditCondition(token), nil
}

func parseAuditCondition(token string) auditExpr {
	if idx := strings.IndexRune(token, ':'); idx > 0 {
		field := strings.ToLower(token[:idx])
		value := strings.Trim(strings.TrimSpace(token[idx+1:]), "\"'")
		return auditCondition{field: field, value: value}
	}
	return auditCondition{field: "", value: strings.Trim(token, "\"'")}
}

func (p *auditParser) peek() string {
	if p.pos >= len(p.tokens) {
		return ""
	}
	return p.tokens[p.pos]
}

func (p *auditParser) next() string {
	if p.pos >= len(p.tokens) {
		return ""
	}
	token := p.tokens[p.pos]
	p.pos++
	return token
}

func (p *auditParser) match(value string) bool {
	if p.peek() != value {
		return false
	}
	p.pos++
	return true
}

func (p *auditParser) matchKeyword(value string) bool {
	if !p.peekKeyword(value) {
		return false
	}
	p.pos++
	return true
}

func (p *auditParser) peekKeyword(value string) bool {
	return strings.EqualFold(p.peek(), value)
}

func filterAuditLogs(logs []models.AuditLog, expr auditExpr) []models.AuditLog {
	if expr == nil {
		return logs
	}
	filtered := make([]models.AuditLog, 0, len(logs))
	for _, log := range logs {
		if expr.Eval(log) {
			filtered = append(filtered, log)
		}
	}
	return filtered
}

func sortAuditLogs(logs []models.AuditLog, sortField, sortOrder string) {
	sort.Slice(logs, func(i, j int) bool {
		left, right := logs[i], logs[j]
		var less bool
		switch sortField {
		case "username":
			less = strings.ToLower(left.Username) < strings.ToLower(right.Username)
		case "action":
			less = strings.ToLower(left.Action) < strings.ToLower(right.Action)
		case "resource":
			less = strings.ToLower(left.Resource) < strings.ToLower(right.Resource)
		case "ip_address":
			less = strings.ToLower(left.IPAddress) < strings.ToLower(right.IPAddress)
		case "success":
			less = !left.Success && right.Success
		default:
			less = left.CreatedAt.Before(right.CreatedAt)
		}
		if sortOrder == "asc" {
			return less
		}
		return !less
	})
}
