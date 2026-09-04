package d1

import (
	"errors"
	"strings"
)

// PrepareSQLQuery separates console statements for D1.prepare without splitting
// quoted values, comments, or trigger bodies. Mixed reads/writes are rejected
// before the deferred batch can persist anything.
func PrepareSQLQuery(query string) ([]string, bool, error) {
	var statements []string
	var words []string
	var hasRead, hasWrite, trigger, body bool
	start, caseDepth, depth := 0, 0, 0
	kind := ""
	finish := func(end int) {
		if len(words) == 0 {
			return
		}
		statements = append(statements, strings.TrimSpace(query[start:end]))
		switch kind {
		case "SELECT", "PRAGMA", "EXPLAIN", "VALUES":
			hasRead = true
		default:
			hasWrite = true
		}
		words = nil
		trigger, body, caseDepth, depth = false, false, 0, 0
		kind = ""
	}
	for i := 0; i < len(query); {
		ch := query[i]
		switch {
		case ch == '\'' || ch == '"' || ch == '`' || ch == '[':
			end := ch
			if ch == '[' {
				end = ']'
			}
			i++
			closed := false
			for i < len(query) {
				if query[i] == end {
					i++
					if end != ']' && i < len(query) && query[i] == end {
						i++
						continue
					}
					closed = true
					break
				}
				i++
			}
			if !closed {
				return nil, false, errors.New("unterminated SQL quote")
			}
		case strings.HasPrefix(query[i:], "--"):
			for i < len(query) && query[i] != '\n' {
				i++
			}
		case strings.HasPrefix(query[i:], "/*"):
			end := strings.Index(query[i+2:], "*/")
			if end < 0 {
				return nil, false, errors.New("unterminated SQL comment")
			}
			i += end + 4
		case ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch == '_':
			begin := i
			for i < len(query) && (query[i] >= 'a' && query[i] <= 'z' || query[i] >= 'A' && query[i] <= 'Z' || query[i] >= '0' && query[i] <= '9' || query[i] == '_') {
				i++
			}
			word := strings.ToUpper(query[begin:i])
			if len(words) == 0 {
				start, kind = begin, word
			}
			if kind == "WITH" && depth == 0 {
				switch word {
				case "SELECT", "VALUES", "INSERT", "UPDATE", "DELETE", "REPLACE":
					kind = word
				}
			}
			words = append(words, word)
			if words[0] == "CREATE" && word == "TRIGGER" && len(words) <= 3 {
				trigger = true
			}
			if trigger {
				switch word {
				case "BEGIN":
					body = true
				case "CASE":
					caseDepth++
				case "END":
					if caseDepth > 0 {
						caseDepth--
					} else {
						body = false
					}
				}
			}
		case ch == '(':
			depth++
			i++
		case ch == ')':
			depth--
			i++
		case ch == ';' && !body && depth == 0:
			finish(i)
			i++
			start = i
		default:
			i++
		}
	}
	finish(len(query))
	if hasRead && hasWrite {
		return nil, false, errors.New("mixed read/write SQL is not supported in a single request on D1; send read-only queries separately")
	}
	return statements, hasWrite, nil
}
