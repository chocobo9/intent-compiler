package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type dataset struct {
	Header []string
	Rows   [][]string
}

func main() {
	if e := run(os.Args[1:]); e != nil {
		if strings.HasPrefix(e.Error(), "ERROR:") {
			fmt.Fprintln(os.Stderr, e)
		} else {
			fmt.Fprintln(os.Stderr, "ERROR:", e)
		}
		os.Exit(1)
	}
}
func run(a []string) error {
	if len(a) == 0 {
		return errors.New("error: command is required")
	}
	switch a[0] {
	case "ingest":
		return ingest(a[1:])
	case "transform":
		return transform(a[1:])
	case "verify":
		return verify(a[1:])
	case "manifest":
		return manifest(a[1:])
	case "pipeline":
		return pipeline(a[1:])
	case "profile":
		return profile(a[1:])
	case "compare":
		return compare(a[1:])
	case "drift":
		return drift(a[1:])
	case "help":
		fmt.Println("dpipe: ingest, transform, verify, manifest, pipeline, profile, compare")
		return nil
	case "--help", "-h":
		fmt.Println("dpipe: ingest, transform, verify, manifest, pipeline, profile, compare, drift")
		return nil
	}
	return fmt.Errorf("error: unknown command %q", a[0])
}
func readCSV(p string) (dataset, error) {
	var r io.Reader = os.Stdin
	var f *os.File
	var e error
	if p != "" && p != "-" {
		f, e = os.Open(p)
		if e != nil {
			return dataset{}, fmt.Errorf("file not found: %s", p)
		}
		defer f.Close()
		r = f
	}
	c := csv.NewReader(r)
	c.FieldsPerRecord = -1
	h, e := c.Read()
	if e == io.EOF {
		return dataset{}, errors.New("CSV: missing header")
	}
	if e != nil {
		return dataset{}, e
	}
	d := dataset{Header: h}
	for n := 2; ; n++ {
		x, e := c.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return dataset{}, fmt.Errorf("CSV: row %d: %w", n, e)
		}
		if len(x) != len(h) {
			return dataset{}, fmt.Errorf("CSV: row %d: expected %d fields, got %d", n, len(h), len(x))
		}
		d.Rows = append(d.Rows, x)
	}
	return d, nil
}
func writeCSV(p string, d dataset) error {
	var w io.Writer = os.Stdout
	var f *os.File
	var e error
	if p != "" && p != "-" {
		f, e = os.Create(p)
		if e != nil {
			return e
		}
		defer f.Close()
		w = f
	}
	c := csv.NewWriter(w)
	if e = c.Write(d.Header); e != nil {
		return e
	}
	for _, r := range d.Rows {
		if e = c.Write(r); e != nil {
			return e
		}
	}
	c.Flush()
	return c.Error()
}
func idx(d dataset, n string) int {
	for i, h := range d.Header {
		if h == n {
			return i
		}
	}
	return -1
}
func schema(p string) (map[string]any, error) {
	b, e := os.ReadFile(p)
	if e != nil {
		return nil, fmt.Errorf("file not found: %s", p)
	}
	var x map[string]any
	e = json.Unmarshal(b, &x)
	if e != nil {
		return nil, fmt.Errorf("malformed JSON: %s", p)
	}
	return x, nil
}
func asStrings(v any) []string {
	var r []string
	switch x := v.(type) {
	case []any:
		for _, z := range x {
			r = append(r, fmt.Sprint(z))
		}
	case []string:
		r = x
	case string:
		if x != "" {
			r = strings.Split(x, ",")
		}
	}
	return r
}
func ingest(a []string) error {
	f := flag.NewFlagSet("ingest", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	in := f.String("input", "-", "")
	sp := f.String("schema", "", "")
	out := f.String("output", "", "")
	rej := f.String("rejected", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	d, e := readCSV(*in)
	if e != nil {
		return e
	}
	if *sp != "" {
		s, e := schema(*sp)
		if e != nil {
			return fmt.Errorf("schema: %w", e)
		}
		rp := *rej
		if rp == "" && *out != "-" {
			rp = *out + ".rejected"
		}
		e = validate(&d, s, rp)
		if e != nil {
			return e
		}
	}
	if e := writeCSV(*out, d); e != nil {
		return e
	}
	return writeChecksum(*out)
}
func validate(d *dataset, s map[string]any, rp string) error {
	if cols, ok := s["columns"].([]any); ok {
		for _, raw := range cols {
			if m, ok := raw.(map[string]any); ok {
				if p, ok := m["pattern"].(string); ok {
					if _, err := regexp.Compile(p); err != nil {
						return fmt.Errorf("invalid pattern: %s", p)
					}
				}
			}
		}
	}
	cols, _ := s["columns"].([]any)
	bad := dataset{Header: append(append([]string{}, d.Header...), "rejection_reason")}
	good := d.Rows[:0]
	for _, r := range d.Rows {
		reason := validateRow(*d, r, cols)
		if reason != "" {
			bad.Rows = append(bad.Rows, append(append([]string{}, r...), reason))
		} else {
			good = append(good, r)
		}
	}
	d.Rows = good
	var uniques []string
	for _, v := range cols {
		if m, ok := v.(map[string]any); ok && m["unique"] == true {
			if n, ok := m["name"].(string); ok {
				uniques = append(uniques, n)
			}
		}
	}
	if u := uniques; len(u) > 0 {
		seen := map[string]map[string]bool{}
		for _, n := range u {
			seen[n] = map[string]bool{}
		}
		accepted := d.Rows[:0]
		for _, r := range d.Rows {
			duplicate := ""
			for _, n := range u {
				j := idx(*d, n)
				if j >= 0 && seen[n][r[j]] {
					duplicate = n
					break
				}
			}
			if duplicate != "" {
				bad.Rows = append(bad.Rows, append(append([]string{}, r...), "duplicate value for unique column: "+duplicate))
				continue
			}
			for _, n := range u {
				seen[n][r[idx(*d, n)]] = true
			}
			accepted = append(accepted, r)
		}
		d.Rows = accepted
	}
	if len(bad.Rows) > 0 {
		if rp == "" {
			rp = "rejected.csv"
		}
		if e := writeCSV(rp, bad); e != nil {
			return e
		}
	}
	pk := asStrings(s["primary_key"])
	if len(pk) == 0 {
		pk = asStrings(s["pk"])
	}
	if len(pk) > 0 {
		types := map[string]string{}
		if cs, ok := s["columns"].([]any); ok {
			for _, v := range cs {
				if m, ok := v.(map[string]any); ok {
					n, _ := m["name"].(string)
					t, _ := m["type"].(string)
					types[n] = t
				}
			}
		}
		sort.SliceStable(d.Rows, func(i, j int) bool {
			for _, n := range pk {
				x, y := d.Rows[i][idx(*d, n)], d.Rows[j][idx(*d, n)]
				if x != y {
					if types[n] == "int" {
						a, e1 := strconv.ParseInt(x, 10, 64)
						b, e2 := strconv.ParseInt(y, 10, 64)
						if e1 == nil && e2 == nil {
							return a < b
						}
					}
					if types[n] == "float" {
						a, e1 := strconv.ParseFloat(x, 64)
						b, e2 := strconv.ParseFloat(y, 64)
						if e1 == nil && e2 == nil {
							return a < b
						}
					}
					return x < y
				}
			}
			return false
		})
	}
	return nil
}

func validateRow(d dataset, r []string, cols []any) string {
	for _, v := range cols {
		m, ok := v.(map[string]any)
		if !ok {
			continue
		}
		n, _ := m["name"].(string)
		j := idx(d, n)
		if j < 0 || (m["required"] == true && strings.TrimSpace(r[j]) == "") {
			return "required: " + n
		}
		if j < 0 || r[j] == "" {
			continue
		}
		typ, _ := m["type"].(string)
		if typ == "int" {
			if _, e := strconv.ParseInt(r[j], 10, 64); e != nil {
				return "invalid type for column " + n + ": " + r[j]
			}
		}
		if typ == "float" {
			if _, e := strconv.ParseFloat(r[j], 64); e != nil {
				return "invalid type for column " + n + ": " + r[j]
			}
		}
		if typ == "datetime" {
			if _, e := time.Parse(time.RFC3339, r[j]); e != nil {
				return "invalid type for column " + n + ": " + r[j]
			}
		}
		if lo, ok := m["min"].(float64); ok && number(r[j]) < lo || func() bool { x, ok := m["max"].(float64); return ok && number(r[j]) > x }() {
			return "value out of range for column " + n + ": " + r[j]
		}
		if p, ok := m["pattern"].(string); ok {
			re, e := regexp.Compile(p)
			if e != nil {
				return "invalid regex: " + p
			}
			if !re.MatchString(r[j]) {
				return "value does not match pattern for column " + n + ": " + r[j]
			}
		}
	}
	return ""
}

type op struct {
	Op           string           `json:"op"`
	Field        string           `json:"field"`
	To           string           `json:"to"`
	Expr         string           `json:"expr"`
	Value        any              `json:"value"`
	Fields       []string         `json:"fields"`
	By           []string         `json:"by"`
	As           string           `json:"as"`
	N            int              `json:"n"`
	Keys         []string         `json:"keys"`
	Right        string           `json:"right"`
	On           string           `json:"on"`
	How          string           `json:"how"`
	Where        string           `json:"where"`
	Spec         map[string]any   `json:"spec"`
	Column       string           `json:"column"`
	Condition    string           `json:"condition"`
	Threshold    float64          `json:"threshold"`
	Name         string           `json:"name"`
	Expression   string           `json:"expression"`
	Fraction     float64          `json:"fraction"`
	Order        string           `json:"order"`
	From         string           `json:"from"`
	GroupBy      []string         `json:"group_by"`
	Aggregations []map[string]any `json:"aggregations"`
	Having       map[string]any   `json:"having"`
	Type         string           `json:"type"`
	Columns      []string         `json:"columns"`
	Names        []string         `json:"names"`
	Keep         string           `json:"keep"`
	Method       string           `json:"method"`
	Function     string           `json:"function"`
	Factor       float64          `json:"factor"`
	Drop         bool             `json:"drop"`
	Message      string           `json:"message"`
	Key          string           `json:"key"`
	Strategy     string           `json:"strategy"`
	PartitionBy  []string         `json:"partition_by"`
	OrderBy      []map[string]any `json:"order_by"`
	SourceColumn string           `json:"source_column"`
	Offset       int              `json:"offset"`
	Default      string           `json:"default"`
	Index        []string         `json:"index"`
	NameTo       string           `json:"name_to"`
	ValueTo      string           `json:"value_to"`
}

func val(v any) string {
	if v == nil {
		return ""
	}
	if x, ok := v.(string); ok {
		return x
	}
	if x, ok := v.(float64); ok {
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}
func number(s string) float64 {
	x, e := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if e != nil {
		return math.NaN()
	}
	return x
}
func condition(v float64, op string, target float64) bool {
	if op == "gt" {
		op = ">"
	}
	if op == "gte" {
		op = ">="
	}
	if op == "lt" {
		op = "<"
	}
	if op == "lte" {
		op = "<="
	}
	if op == "eq" {
		op = "=="
	}
	if op == "neq" {
		op = "!="
	}
	switch op {
	case ">":
		return v > target
	case ">=":
		return v >= target
	case "<":
		return v < target
	case "<=":
		return v <= target
	case "==", "=":
		return v == target
	case "!=":
		return v != target
	}
	return false
}
func requireColumns(d dataset, names ...string) error {
	for _, n := range names {
		if n != "" && idx(d, n) < 0 {
			return fmt.Errorf("transform: field %q not found", n)
		}
	}
	return nil
}
func removeName(xs []string, name string) []string {
	out := []string{}
	for _, x := range xs {
		if x != name {
			out = append(out, x)
		}
	}
	return out
}
func unpivotBase(r []string, h, cols []string) []string {
	out := []string{}
	for i, n := range h {
		found := false
		for _, c := range cols {
			if n == c {
				found = true
			}
		}
		if !found {
			out = append(out, r[i])
		}
	}
	return out
}
func eval(x string, r map[string]string) string {
	p := &exprParser{s: strings.TrimSpace(x), r: r}
	v := p.parseOr()
	if math.IsNaN(v) {
		return "NaN"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

type exprParser struct {
	s string
	r map[string]string
	i int
}

func (p *exprParser) ws() {
	for p.i < len(p.s) && p.s[p.i] == ' ' {
		p.i++
	}
}
func (p *exprParser) eat(x string) bool {
	p.ws()
	if strings.HasPrefix(p.s[p.i:], x) {
		p.i += len(x)
		return true
	}
	return false
}
func (p *exprParser) parseOr() float64 {
	v := p.parseAnd()
	for p.eat("||") {
		b := p.parseAnd()
		if v > 0 || b > 0 {
			v = 1
		} else {
			v = 0
		}
	}
	return v
}
func (p *exprParser) parseAnd() float64 {
	v := p.parseEq()
	for p.eat("&&") {
		b := p.parseEq()
		if v > 0 && b > 0 {
			v = 1
		} else {
			v = 0
		}
	}
	return v
}
func (p *exprParser) cmp(a, b float64, op string) float64 {
	if math.IsNaN(a) || math.IsNaN(b) {
		return 0
	}
	ok := map[string]bool{"==": a == b, "!=": a != b, ">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
	if ok {
		return 1
	}
	return 0
}
func (p *exprParser) parseEq() float64 {
	a := p.parseRel()
	for {
		for _, o := range []string{"==", "!="} {
			if p.eat(o) {
				a = p.cmp(a, p.parseRel(), o)
				goto next
			}
		}
		break
	next:
	}
	return a
}
func (p *exprParser) parseRel() float64 {
	a := p.parseAdd()
	for {
		matched := false
		for _, o := range []string{"<=", ">=", "<", ">"} {
			if p.eat(o) {
				a = p.cmp(a, p.parseAdd(), o)
				matched = true
				break
			}
		}
		if !matched {
			break
		}
	}
	return a
}
func (p *exprParser) parseAdd() float64 {
	a := p.parseMul()
	for {
		if p.eat("+") {
			a += p.parseMul()
		} else if p.eat("-") {
			a -= p.parseMul()
		} else {
			break
		}
	}
	return a
}
func (p *exprParser) parseMul() float64 {
	a := p.parseUnary()
	for {
		if p.eat("*") {
			a *= p.parseUnary()
		} else if p.eat("/") {
			b := p.parseUnary()
			if b == 0 {
				a = math.NaN()
			} else {
				a /= b
			}
		} else if p.eat("%") {
			b := p.parseUnary()
			if b == 0 {
				a = math.NaN()
			} else {
				a = math.Mod(a, b)
			}
		} else {
			break
		}
	}
	return a
}
func (p *exprParser) parseUnary() float64 {
	if p.eat("-") {
		return -p.parseUnary()
	}
	return p.parsePrimary()
}
func (p *exprParser) parsePrimary() float64 {
	p.ws()
	if p.eat("(") {
		v := p.parseOr()
		p.eat(")")
		return v
	}
	start := p.i
	for p.i < len(p.s) && ((p.s[p.i] >= 'a' && p.s[p.i] <= 'z') || (p.s[p.i] >= 'A' && p.s[p.i] <= 'Z') || (p.s[p.i] >= '0' && p.s[p.i] <= '9') || p.s[p.i] == '.' || p.s[p.i] == '_') {
		p.i++
	}
	t := p.s[start:p.i]
	p.ws()
	if p.eat("(") {
		var a []float64
		for !p.eat(")") {
			a = append(a, p.parseOr())
			if !p.eat(",") {
				p.eat(")")
				break
			}
		}
		return fn(t, a)
	}
	if v, e := strconv.ParseFloat(t, 64); e == nil {
		return v
	}
	return number(p.r[t])
}
func fn(n string, a []float64) float64 {
	switch n {
	case "abs":
		return math.Abs(a[0])
	case "sqrt":
		return math.Sqrt(a[0])
	case "ceil":
		return math.Ceil(a[0])
	case "floor":
		return math.Floor(a[0])
	case "pow":
		return math.Pow(a[0], a[1])
	case "log":
		return math.Log(a[0])
	case "min":
		return math.Min(a[0], a[1])
	case "max":
		return math.Max(a[0], a[1])
	case "if":
		if a[0] > 0 {
			return a[1]
		}
		return a[2]
	case "clamp":
		return math.Min(math.Max(a[0], a[1]), a[2])
	case "coalesce":
		if !math.IsNaN(a[0]) {
			return a[0]
		}
		return a[1]
	case "round":
		m := math.Pow10(int(a[1]))
		return math.Round(a[0]*m) / m
	}
	return math.NaN()
}
func transformData(d *dataset, osx []op, seed int64) error {
	for _, o := range osx {
		switch strings.ToLower(o.Op) {
		case "set", "add":
			j := idx(*d, o.Field)
			if j < 0 {
				d.Header = append(d.Header, o.Field)
				for i := range d.Rows {
					d.Rows[i] = append(d.Rows[i], val(o.Value))
				}
			} else {
				for i := range d.Rows {
					d.Rows[i][j] = val(o.Value)
				}
			}
		case "derive", "compute", "filter":
			if o.Op == "filter" {
				if idx(*d, o.Column) < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", o.Column)
				}
				keep := d.Rows[:0]
				for _, r := range d.Rows {
					v := number(r[idx(*d, o.Column)])
					if condition(v, o.Condition, o.Threshold) {
						keep = append(keep, r)
					}
				}
				d.Rows = keep
			} else {
				d.Header = append(d.Header, o.Field)
				for i, r := range d.Rows {
					m := map[string]string{}
					for j, h := range d.Header {
						if j < len(r) {
							m[h] = r[j]
						}
					}
					d.Rows[i] = append(r, eval(o.Expr, m))
				}
			}
		case "drop", "remove":
			remove := append([]string{}, o.Columns...)
			if len(remove) == 0 && o.Field != "" {
				remove = []string{o.Field}
			}
			for _, name := range remove {
				j := idx(*d, name)
				if j >= 0 {
					d.Header = append(d.Header[:j], d.Header[j+1:]...)
					for i := range d.Rows {
						d.Rows[i] = append(d.Rows[i][:j], d.Rows[i][j+1:]...)
					}
				}
			}
		case "rename":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			d.Header[j] = o.To
		case "upper", "lower", "trim":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			for i := range d.Rows {
				if o.Op == "upper" {
					d.Rows[i][j] = strings.ToUpper(d.Rows[i][j])
				}
				if o.Op == "lower" {
					d.Rows[i][j] = strings.ToLower(d.Rows[i][j])
				}
				if o.Op == "trim" {
					d.Rows[i][j] = strings.TrimSpace(d.Rows[i][j])
				}
			}
		case "sort":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			if j >= 0 {
				sort.SliceStable(d.Rows, func(i, jj int) bool {
					if strings.ToLower(o.Order) == "desc" {
						return d.Rows[i][j] > d.Rows[jj][j]
					}
					return d.Rows[i][j] < d.Rows[jj][j]
				})
			}
		case "sample":
			rng := rand.New(rand.NewSource(seed))
			keep := d.Rows[:0]
			for _, r := range d.Rows {
				if rng.Float64() < o.Fraction {
					keep = append(keep, r)
				}
			}
			d.Rows = keep
		case "shuffle":
			rand.New(rand.NewSource(seed)).Shuffle(len(d.Rows), func(i, j int) { d.Rows[i], d.Rows[j] = d.Rows[j], d.Rows[i] })
		case "fill":
			cols := o.Columns
			if len(cols) == 0 {
				cols = []string{o.Field}
			}
			if err := requireColumns(*d, cols...); err != nil {
				return err
			}
			strategy := strings.ToLower(o.Type)
			if strategy == "" {
				strategy = strings.ToLower(o.Strategy)
			}
			if strategy == "" {
				strategy = "forward"
			}
			for _, col := range cols {
				j := idx(*d, col)
				switch strategy {
				case "constant":
					for i := range d.Rows {
						if d.Rows[i][j] == "" {
							d.Rows[i][j] = val(o.Value)
						}
					}
				case "backward":
					last := ""
					for i := len(d.Rows) - 1; i >= 0; i-- {
						if d.Rows[i][j] == "" {
							d.Rows[i][j] = last
						} else {
							last = d.Rows[i][j]
						}
					}
				case "linear":
					for i := range d.Rows {
						if d.Rows[i][j] != "" {
							continue
						}
						lo, hi := -1, -1
						var lv, hv float64
						for k := i - 1; k >= 0; k-- {
							if x, e := strconv.ParseFloat(d.Rows[k][j], 64); e == nil {
								lo = k
								lv = x
								break
							}
						}
						for k := i + 1; k < len(d.Rows); k++ {
							if x, e := strconv.ParseFloat(d.Rows[k][j], 64); e == nil {
								hi = k
								hv = x
								break
							}
						}
						if lo >= 0 && hi >= 0 {
							d.Rows[i][j] = strconv.FormatFloat(lv+(hv-lv)*float64(i-lo)/float64(hi-lo), 'f', -1, 64)
						} else if lo >= 0 {
							d.Rows[i][j] = strconv.FormatFloat(lv, 'f', -1, 64)
						} else if hi >= 0 {
							d.Rows[i][j] = strconv.FormatFloat(hv, 'f', -1, 64)
						}
					}
				default:
					last := ""
					for i := range d.Rows {
						if d.Rows[i][j] == "" {
							d.Rows[i][j] = last
						} else {
							last = d.Rows[i][j]
						}
					}
				}
			}
		case "aggregate", "groupby":
			by := o.By
			if len(by) == 0 {
				by = o.Fields
			}
			if err := requireColumns(*d, by...); err != nil {
				return err
			}
			groups := map[string][]string{}
			order := []string{}
			for _, r := range d.Rows {
				var k []string
				for _, n := range by {
					j := idx(*d, n)
					if j >= 0 {
						k = append(k, r[j])
					}
				}
				key := strings.Join(k, "\x00")
				if _, ok := groups[key]; !ok {
					order = append(order, key)
					groups[key] = r
				}
			}
			out := dataset{Header: append([]string{}, by...)}
			aggs := o.Aggregations
			if len(aggs) == 0 {
				aggs = []map[string]any{{"function": "count", "as": o.As}}
			}
			for _, a := range aggs {
				name, _ := a["as"].(string)
				if name == "" {
					name, _ = a["name"].(string)
				}
				out.Header = append(out.Header, name)
			}
			for _, key := range order {
				r := groups[key]
				nr := []string{}
				for _, n := range by {
					nr = append(nr, r[idx(*d, n)])
				}
				members := [][]string{}
				for _, x := range d.Rows {
					var k []string
					for _, n := range by {
						k = append(k, x[idx(*d, n)])
					}
					if strings.Join(k, "\x00") == key {
						members = append(members, x)
					}
				}
				for _, a := range aggs {
					fn, _ := a["function"].(string)
					col, _ := a["column"].(string)
					j := idx(*d, col)
					if fn == "count" {
						count := 0
						for _, x := range members {
							if j >= 0 && x[j] != "" {
								count++
							}
						}
						nr = append(nr, strconv.Itoa(count))
						continue
					}
					sum, min, max := 0.0, math.Inf(1), math.Inf(-1)
					count := 0
					for _, x := range members {
						if j >= 0 {
							v := number(x[j])
							if !math.IsNaN(v) {
								sum += v
								count++
								if v < min {
									min = v
								}
								if v > max {
									max = v
								}
							}
						}
					}
					v := 0.0
					switch fn {
					case "sum":
						v = sum
					case "avg", "mean":
						if count > 0 {
							v = sum / float64(count)
						} else {
							v = math.NaN()
						}
					case "min":
						if count > 0 {
							v = min
						} else {
							v = math.NaN()
						}
					case "max":
						if count > 0 {
							v = max
						} else {
							v = math.NaN()
						}
					}
					if math.IsNaN(v) {
						nr = append(nr, "NaN")
					} else {
						nr = append(nr, strconv.FormatFloat(v, 'f', -1, 64))
					}
				}
				out.Rows = append(out.Rows, nr)
			}
			sort.SliceStable(out.Rows, func(i, j int) bool {
				for k := range by {
					if out.Rows[i][k] != out.Rows[j][k] {
						return out.Rows[i][k] < out.Rows[j][k]
					}
				}
				return false
			})
			if o.Having != nil {
				column, _ := o.Having["column"].(string)
				cond, _ := o.Having["condition"].(string)
				threshold, _ := o.Having["threshold"].(float64)
				j := idx(out, column)
				keep := out.Rows[:0]
				if j >= 0 {
					for _, r := range out.Rows {
						v := number(r[j])
						ok := condition(v, cond, threshold)
						if ok {
							keep = append(keep, r)
						}
					}
				} else {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", column)
				}
				out.Rows = keep
			}
			*d = out
		case "having":
			keep := d.Rows[:0]
			for _, r := range d.Rows {
				m := map[string]string{}
				for i, h := range d.Header {
					m[h] = r[i]
				}
				if eval(o.Expr, m) != "" && eval(o.Expr, m) != "false" && eval(o.Expr, m) != "0" {
					keep = append(keep, r)
				}
			}
			d.Rows = keep
		case "unpivot":
			cols := o.Columns
			if len(cols) == 0 {
				cols = o.Fields
			}
			if len(cols) == 0 {
				return errors.New("transform: unpivot requires columns")
			}
			if err := requireColumns(*d, cols...); err != nil {
				return err
			}
			keep := append([]string{}, d.Header...)
			for _, c := range cols {
				keep = removeName(keep, c)
			}
			nameTo, valueTo := o.As, o.To
			if nameTo == "" {
				nameTo = o.NameTo
			}
			if valueTo == "" {
				valueTo = o.ValueTo
			}
			if nameTo == "" {
				nameTo = "variable"
			}
			if valueTo == "" {
				valueTo = "value"
			}
			keep = append(keep, nameTo, valueTo)
			out := dataset{Header: keep}
			for _, r := range d.Rows {
				for _, c := range cols {
					out.Rows = append(out.Rows, append(unpivotBase(r, d.Header, cols), c, r[idx(*d, c)]))
				}
			}
			*d = out
		case "pivot":
			if len(o.Index) > 0 {
				if err := requireColumns(*d, append(append([]string{}, o.Index...), o.Field, o.As)...); err != nil {
					return fmt.Errorf("ERROR: invalid recipe: column not found")
				}
				vals := map[string]bool{}
				keys := map[string][]string{}
				for _, r := range d.Rows {
					k := []string{}
					for _, n := range o.Index {
						k = append(k, r[idx(*d, n)])
					}
					ks := strings.Join(k, "\x00")
					keys[ks] = k
					vals[r[idx(*d, o.Field)]] = true
				}
				heads := []string{}
				for v := range vals {
					heads = append(heads, v)
				}
				sort.Strings(heads)
				out := dataset{Header: append(append([]string{}, o.Index...), heads...)}
				for _, k := range keys {
					row := append([]string{}, k...)
					for _, h := range heads {
						cell := ""
						for _, r := range d.Rows {
							ok := true
							for z, n := range o.Index {
								if r[idx(*d, n)] != k[z] {
									ok = false
								}
							}
							if ok && r[idx(*d, o.Field)] == h {
								cell = r[idx(*d, o.As)]
								break
							}
						}
						row = append(row, cell)
					}
					out.Rows = append(out.Rows, row)
				}
				sort.Slice(out.Rows, func(i, j int) bool { return strings.Join(out.Rows[i], "\x00") < strings.Join(out.Rows[j], "\x00") })
				*d = out
				continue
			}
			if o.Field == "" || o.As == "" {
				return errors.New("transform: pivot requires field and as")
			}
			if err := requireColumns(*d, o.Field, o.As); err != nil {
				return err
			}
			keys := map[string][]string{}
			order := []string{}
			fj, vj := idx(*d, o.Field), idx(*d, o.As)
			for _, r := range d.Rows {
				k := r[fj]
				if _, ok := keys[k]; !ok {
					order = append(order, k)
				}
				keys[k] = append(keys[k], r[vj])
			}
			out := dataset{Header: []string{o.Field}}
			for _, k := range order {
				out.Header = append(out.Header, k)
			}
			base := o.To
			if base != "" {
				out.Header = []string{base}
				out.Header = append(out.Header, order...)
			}
			nr := []string{base}
			for _, k := range order {
				nr = append(nr, strings.Join(keys[k], ","))
			}
			out.Rows = [][]string{nr}
			*d = out
		case "window":
			name := o.As
			if name == "" {
				name = "row_number"
			}
			for _, n := range append(append([]string{}, o.By...), o.Order) {
				if n != "" && idx(*d, n) < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", n)
				}
			}
			for _, spec := range o.OrderBy {
				if n, ok := spec["column"].(string); ok && idx(*d, n) < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", n)
				}
			}
			if o.Field != "" && idx(*d, o.Field) < 0 {
				return fmt.Errorf("ERROR: invalid recipe: column %s not found", o.Field)
			}
			if o.SourceColumn != "" && idx(*d, o.SourceColumn) < 0 {
				return fmt.Errorf("ERROR: invalid recipe: column %s not found", o.SourceColumn)
			}
			orig := append([][]string(nil), d.Rows...)
			order := make([]int, len(orig))
			for i := range order {
				order[i] = i
			}
			sort.SliceStable(order, func(a, b int) bool {
				i, j := order[a], order[b]
				for _, n := range o.By {
					if orig[i][idx(*d, n)] != orig[j][idx(*d, n)] {
						return orig[i][idx(*d, n)] < orig[j][idx(*d, n)]
					}
				}
				if len(o.OrderBy) > 0 {
					for _, spec := range o.OrderBy {
						n, _ := spec["column"].(string)
						if orig[i][idx(*d, n)] != orig[j][idx(*d, n)] {
							less := orig[i][idx(*d, n)] < orig[j][idx(*d, n)]
							if strings.ToLower(val(spec["order"])) == "desc" {
								return !less
							}
							return less
						}
					}
				} else if o.Order != "" {
					return orig[i][idx(*d, o.Order)] < orig[j][idx(*d, o.Order)]
				}
				return false
			})
			results := make([]string, len(orig))
			counts := map[string]int{}
			sums := map[string]float64{}
			nums := map[string]int{}
			lastKey := ""
			rank := 0
			for pos, ri := range order {
				key := ""
				for _, n := range o.By {
					key += "\x00" + orig[ri][idx(*d, n)]
				}
				counts[key]++
				if key != lastKey {
					rank = pos + 1
					lastKey = key
				}
				typ := strings.ToLower(o.Function)
				if typ == "" {
					typ = strings.ToLower(o.Type)
				}
				if typ == "lag" || typ == "lead" {
					off := o.Offset
					if off <= 0 {
						off = 1
					}
					p := pos - off
					if typ == "lead" {
						p = pos + off
					}
					if p >= 0 && p < len(order) {
						results[ri] = orig[order[p]][idx(*d, o.SourceColumn)]
					} else {
						results[ri] = o.Default
					}
					continue
				}
				if typ == "row_number" {
					results[ri] = strconv.Itoa(counts[key])
					continue
				}
				if typ == "running_sum" {
					v := number(orig[ri][idx(*d, o.SourceColumn)])
					if !math.IsNaN(v) {
						sums[key] += v
					}
					results[ri] = strconv.FormatFloat(sums[key], 'f', -1, 64)
					continue
				}
				if typ == "running_avg" {
					v := number(orig[ri][idx(*d, o.SourceColumn)])
					if !math.IsNaN(v) {
						sums[key] += v
						nums[key]++
					}
					if nums[key] == 0 {
						results[ri] = "NaN"
					} else {
						results[ri] = strconv.FormatFloat(sums[key]/float64(nums[key]), 'f', -1, 64)
					}
				} else {
					results[ri] = strconv.Itoa(rank)
				}
			}
			d.Header = append(d.Header, name)
			for i := range d.Rows {
				d.Rows[i] = append(orig[i], results[i])
			}
		case "join":
			if o.Right == "" {
				return errors.New("transform: join requires right")
			}
			rd, e := readCSV(o.Right)
			if e != nil {
				return e
			}
			leftName, rightName := o.Field, o.To
			if o.On != "" {
				parts := strings.SplitN(o.On, "=", 2)
				leftName, rightName = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[len(parts)-1])
			}
			left, right := idx(*d, leftName), idx(rd, rightName)
			if left < 0 || right < 0 {
				return errors.New("transform: join key not found")
			}
			newHeader := append([]string{}, d.Header...)
			for j, h := range rd.Header {
				if j != right {
					newHeader = append(newHeader, h)
				}
			}
			out := dataset{Header: newHeader}
			for _, r := range d.Rows {
				matched := false
				for _, q := range rd.Rows {
					if r[left] == q[right] {
						nr := append([]string{}, r...)
						for j := range rd.Header {
							if j != right {
								nr = append(nr, q[j])
							}
						}
						out.Rows = append(out.Rows, nr)
						matched = true
						break
					}
				}
				if !matched && strings.ToLower(o.How) == "left" {
					nr := append([]string{}, r...)
					for j := range rd.Header {
						if j != right {
							nr = append(nr, "")
						}
					}
					out.Rows = append(out.Rows, nr)
				}
			}
			*d = out
		case "deduplicate", "dedupe":
			cols := o.Fields
			if len(cols) == 0 {
				cols = o.Columns
			}
			if len(cols) == 0 {
				cols = []string{o.Field}
			}
			if err := requireColumns(*d, cols...); err != nil {
				return err
			}
			if o.Keep == "last" {
				seen := map[string]bool{}
				keep := [][]string{}
				for i := len(d.Rows) - 1; i >= 0; i-- {
					k := ""
					for _, n := range cols {
						k += "\x00" + d.Rows[i][idx(*d, n)]
					}
					if !seen[k] {
						seen[k] = true
						keep = append(keep, d.Rows[i])
					}
				}
				for i, j := 0, len(keep)-1; i < j; i, j = i+1, j-1 {
					keep[i], keep[j] = keep[j], keep[i]
				}
				d.Rows = keep
				continue
			}
			seen := map[string]bool{}
			keep := d.Rows[:0]
			for _, r := range d.Rows {
				k := ""
				for _, n := range cols {
					k += "\x00" + r[idx(*d, n)]
				}
				if !seen[k] {
					seen[k] = true
					keep = append(keep, r)
				}
			}
			d.Rows = keep
		case "split":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			sep := o.To
			if sep == "" {
				sep = ","
			}
			names := o.Names
			if len(names) == 0 {
				names = o.Columns
			}
			if len(names) == 0 {
				return errors.New("transform: split requires columns")
			}
			newHeader := append([]string{}, d.Header[:j]...)
			newHeader = append(newHeader, names...)
			newHeader = append(newHeader, d.Header[j+1:]...)
			for i, r := range d.Rows {
				p := strings.Split(r[j], sep)
				nr := append([]string{}, r[:j]...)
				for k := range names {
					v := ""
					if k == len(names)-1 && len(p) > len(names) {
						v = strings.Join(p[k:], sep)
					} else if k < len(p) {
						v = p[k]
					}
					nr = append(nr, v)
				}
				nr = append(nr, r[j+1:]...)
				d.Rows[i] = nr
			}
			d.Header = newHeader
		case "assert":
			for ri, r := range d.Rows {
				m := map[string]string{}
				for i, h := range d.Header {
					m[h] = r[i]
				}
				if eval(o.Expr, m) == "0" {
					return fmt.Errorf("ERROR: assertion failed on row %d: %s", ri+1, o.Message)
				}
			}
		case "normalize":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			lo, hi := math.Inf(1), math.Inf(-1)
			for _, r := range d.Rows {
				v := number(r[j])
				if !math.IsNaN(v) && v < lo {
					lo = v
				}
				if !math.IsNaN(v) && v > hi {
					hi = v
				}
			}
			method := o.Method
			if method == "" {
				method = "minmax"
			}
			valid := []float64{}
			for _, q := range d.Rows {
				if x := number(q[j]); !math.IsNaN(x) {
					valid = append(valid, x)
				}
			}
			mean := 0.0
			for _, x := range valid {
				mean += x
			}
			if len(valid) > 0 {
				mean /= float64(len(valid))
			}
			ss := 0.0
			for _, x := range valid {
				ss += (x - mean) * (x - mean)
			}
			sd := 0.0
			if len(valid) > 1 {
				sd = math.Sqrt(ss / float64(len(valid)-1))
			}
			name := o.As
			if name == "" {
				name = "normalized"
			}
			d.Header = append(d.Header, name)
			for i, r := range d.Rows {
				v := number(r[j])
				res := 0.0
				if method == "zscore" {
					if sd > 0 {
						res = (v - mean) / sd
					}
				} else if hi > lo {
					res = (v - lo) / (hi - lo)
				}
				d.Rows[i] = append(d.Rows[i], strconv.FormatFloat(res, 'f', -1, 64))
			}
		case "hash":
			cols := o.Columns
			if len(cols) == 0 {
				cols = d.Header
			}
			js := []int{}
			for _, n := range cols {
				j := idx(*d, n)
				if j < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", n)
				}
				js = append(js, j)
			}
			name := o.As
			if name == "" {
				name = "hash"
			}
			d.Header = append(d.Header, name)
			for i, r := range d.Rows {
				parts := []string{}
				for _, j := range js {
					parts = append(parts, r[j])
				}
				h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
				d.Rows[i] = append(r, hex.EncodeToString(h[:]))
			}
			continue
		case "watermark":
			cols := o.Columns
			if len(cols) == 0 {
				cols = d.Header
			}
			jsw := []int{}
			for _, n := range cols {
				j := idx(*d, n)
				if j < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", n)
				}
				jsw = append(jsw, j)
			}
			namew := o.As
			if namew == "" {
				namew = "watermark"
			}
			d.Header = append(d.Header, namew)
			key := []byte(o.Key)
			if len(key) == 0 {
				key = []byte(val(o.Value))
			}
			for i, r := range d.Rows {
				mac := hmac.New(sha256.New, key)
				parts := []string{}
				for _, j := range jsw {
					parts = append(parts, r[j])
				}
				mac.Write([]byte(strings.Join(parts, "\x00")))
				d.Rows[i] = append(r, hex.EncodeToString(mac.Sum(nil)[:8]))
			}
			js := []int{}
			for _, n := range cols {
				j := idx(*d, n)
				if j < 0 {
					return fmt.Errorf("ERROR: invalid recipe: column %s not found", n)
				}
				js = append(js, j)
			}
			name2 := o.As
			if name2 == "" {
				name2 = "hash"
			}
			d.Header = append(d.Header, name2)
			for i, r := range d.Rows {
				parts := []string{}
				for _, j := range js {
					parts = append(parts, r[j])
				}
				h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
				d.Rows[i] = append(r, hex.EncodeToString(h[:]))
			}
		case "encode":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			vals := map[string]bool{}
			for _, r := range d.Rows {
				if r[j] != "" {
					vals[r[j]] = true
				}
			}
			cats := []string{}
			for v := range vals {
				cats = append(cats, v)
			}
			sort.Strings(cats)
			if o.Method == "onehot" {
				if o.Drop {
					h := append([]string{}, d.Header[:j]...)
					for _, v := range cats {
						h = append(h, o.Field+"_"+v)
					}
					h = append(h, d.Header[j+1:]...)
					for i, r := range d.Rows {
						nr := append([]string{}, r[:j]...)
						for _, v := range cats {
							if r[j] == v {
								nr = append(nr, "1")
							} else {
								nr = append(nr, "0")
							}
						}
						nr = append(nr, r[j+1:]...)
						d.Rows[i] = nr
					}
					d.Header = h
				} else {
					d.Header = append(d.Header, func() string {
						h := []string{}
						for _, v := range cats {
							h = append(h, o.Field+"_"+v)
						}
						return strings.Join(h, "\x00")
					}())
					for i, r := range d.Rows {
						for _, v := range cats {
							if r[j] == v {
								d.Rows[i] = append(r, "1")
							} else {
								d.Rows[i] = append(d.Rows[i], "0")
							}
						}
					}
					if len(cats) > 0 {
						d.Header = append(d.Header[:len(d.Header)-1], strings.Split(strings.TrimSuffix(d.Header[len(d.Header)-1], "\x00"), "\x00")...)
					}
				}
			} else {
				m := map[string]int{}
				for i, v := range cats {
					m[v] = i
				}
				name := o.As
				if name == "" {
					name = "code"
				}
				d.Header = append(d.Header, name)
				for i, r := range d.Rows {
					z := ""
					if k, ok := m[r[j]]; ok {
						z = strconv.Itoa(k)
					}
					d.Rows[i] = append(r, z)
				}
			}
		case "resample":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("ERROR: invalid recipe: column %s not found", o.Field)
			}
			g := map[string][][]string{}
			for _, r := range d.Rows {
				g[r[j]] = append(g[r[j]], r)
			}
			ks := []string{}
			for k := range g {
				ks = append(ks, k)
			}
			sort.Strings(ks)
			target := 0
			if o.Strategy == "undersample" {
				target = 1 << 30
				for _, k := range ks {
					if len(g[k]) < target {
						target = len(g[k])
					}
				}
			} else {
				for _, k := range ks {
					if len(g[k]) > target {
						target = len(g[k])
					}
				}
			}
			out := [][]string{}
			for _, k := range ks {
				for i := 0; i < target; i++ {
					out = append(out, g[k][i%len(g[k])])
				}
			}
			d.Rows = out
		case "bin":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			d.Header = append(d.Header, o.As)
			min, max := math.Inf(1), math.Inf(-1)
			for _, r := range d.Rows {
				v := number(r[j])
				if !math.IsNaN(v) {
					if v < min {
						min = v
					}
					if v > max {
						max = v
					}
				}
			}
			n := o.N
			if n <= 0 {
				n = 2
			}
			w := (max - min) / float64(n)
			if max == min {
				d.Header[len(d.Header)-1] = o.As
				for i, r := range d.Rows {
					if !math.IsNaN(number(r[j])) {
						d.Rows[i] = append(r, "["+strconv.FormatFloat(min, 'f', -1, 64)+","+strconv.FormatFloat(max, 'f', -1, 64)+"]")
					} else {
						d.Rows[i] = append(r, "")
					}
				}
				continue
			}
			for i, r := range d.Rows {
				v := number(r[j])
				label := ""
				if !math.IsNaN(v) {
					k := int(math.Floor((v - min) / w))
					if k < 0 {
						k = 0
					}
					if k >= n {
						k = n - 1
					}
					lo := min + float64(k)*w
					hi := min + float64(k+1)*w
					if k == n-1 {
						hi = max
					}
					close := ")"
					if k == n-1 {
						close = "]"
					}
					label = "[" + strconv.FormatFloat(lo, 'f', -1, 64) + "," + strconv.FormatFloat(hi, 'f', -1, 64) + close
				}
				d.Rows[i] = append(r, label)
			}
		case "detect":
			j := idx(*d, o.Field)
			if j < 0 {
				return fmt.Errorf("transform: field %q not found", o.Field)
			}
			d.Header = append(d.Header, o.As)
			vals := []float64{}
			for _, r := range d.Rows {
				if v := number(r[j]); !math.IsNaN(v) {
					vals = append(vals, v)
				}
			}
			if strings.ToLower(o.Method) == "iqr" || strings.ToLower(o.Method) == "mad" {
				sort.Float64s(vals)
			}
			if strings.ToLower(o.Method) == "iqr" {
				q := func(p float64) float64 {
					x := p * float64(len(vals)-1)
					lo := int(math.Floor(x))
					hi := int(math.Ceil(x))
					return vals[lo] + (vals[hi]-vals[lo])*(x-float64(lo))
				}
				q1, q3 := q(.25), q(.75)
				for i, r := range d.Rows {
					v := number(r[j])
					z := "0"
					if !math.IsNaN(v) && (v < q1-o.Factor*(q3-q1) || v > q3+o.Factor*(q3-q1)) {
						z = "1"
					}
					d.Rows[i] = append(r, z)
				}
				continue
			}
			mean := 0.0
			for _, v := range vals {
				mean += v
			}
			mean /= float64(len(vals))
			ss := 0.0
			for _, v := range vals {
				ss += (v - mean) * (v - mean)
			}
			sd := math.Sqrt(ss / float64(len(vals)))
			for i, r := range d.Rows {
				v := number(r[j])
				z := "0"
				if !math.IsNaN(v) && sd > 0 && math.Abs(v-mean)/sd > o.Factor {
					z = "1"
				}
				d.Rows[i] = append(r, z)
			}
		case "rollup":
			by := o.By
			if len(by) == 0 {
				by = o.Fields
			}
			if err := requireColumns(*d, by...); err != nil {
				return err
			}
			d.Header = append(d.Header, o.As)
			for i := range d.Rows {
				d.Rows[i] = append(d.Rows[i], strconv.Itoa(len(d.Rows)))
			}
		default:
			return fmt.Errorf("transform: unknown operation %q", o.Op)
		}
	}
	return nil
}
func transform(a []string) error {
	f := flag.NewFlagSet("transform", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	in := f.String("input", "-", "")
	rp := f.String("recipe", "", "")
	out := f.String("output", "-", "")
	seed := f.Int64("seed", 0, "")
	if e := f.Parse(a); e != nil {
		return e
	}
	d, e := readCSV(*in)
	if e != nil {
		return e
	}
	b, e := os.ReadFile(*rp)
	if e != nil {
		return fmt.Errorf("file not found: %s", *rp)
	}
	var x []op
	if e = json.Unmarshal(b, &x); e != nil {
		var z struct {
			Operations []op `json:"operations"`
		}
		if e = json.Unmarshal(b, &z); e != nil {
			return fmt.Errorf("malformed JSON: %s", *rp)
		}
		x = z.Operations
	}
	for i := range x {
		if x[i].Field == "" {
			x[i].Field = x[i].Column
		}
		if x[i].Field == "" {
			x[i].Field = x[i].Name
		}
		if x[i].Expr == "" {
			x[i].Expr = x[i].Expression
		}
		if x[i].Field == "" {
			x[i].Field = x[i].From
		}
		if len(x[i].By) == 0 {
			x[i].By = x[i].GroupBy
		}
		if len(x[i].By) == 0 {
			x[i].By = x[i].PartitionBy
		}
		if x[i].Field == "" {
			x[i].Field = x[i].SourceColumn
		}
		if x[i].How == "" {
			x[i].How = x[i].Type
		}
		if x[i].Op == "window" && x[i].Type == "" && len(x[i].OrderBy) > 0 {
			if v, ok := x[i].OrderBy[0]["column"].(string); ok {
				x[i].Order = v
			}
		}
		if x[i].Op == "pivot" && x[i].Field == "" {
			x[i].Field = x[i].Column
		}
		if x[i].Op == "pivot" && len(x[i].Index) > 0 {
			x[i].Field = x[i].Column
			x[i].As = val(x[i].Value)
		}
		if x[i].N == 0 && x[i].Fraction != 0 {
			x[i].N = -1
		}
	}
	if e = transformData(&d, x, *seed); e != nil {
		return e
	}
	if e = writeCSV(*out, d); e != nil {
		return e
	}
	return writeChecksum(*out)
}
func writeChecksum(p string) error {
	s, e := checksum(p)
	if e != nil {
		return e
	}
	return os.WriteFile(p+".sha256", []byte(s+"\n"), 0644)
}
func checksum(p string) (string, error) {
	b, e := os.ReadFile(p)
	if e != nil {
		return "", fmt.Errorf("file not found: %s", p)
	}
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:]), nil
}
func verify(a []string) error {
	f := flag.NewFlagSet("verify", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	p := f.String("file", "", "")
	w := f.String("checksum", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	g, e := checksum(*p)
	if e != nil {
		return e
	}
	if *w != "" {
		b, e := os.ReadFile(*w)
		if e != nil {
			return e
		}
		expected := strings.TrimSpace(string(b))
		if strings.ToLower(g) != strings.ToLower(expected) {
			fmt.Printf("MISMATCH expected=%s actual=%s\n", expected, g)
			return errors.New("checksum mismatch")
		}
	}
	fmt.Println("VERIFIED")
	return nil
}

type mf struct {
	Path   string `json:"path"`
	Rows   int    `json:"rows"`
	Size   int64  `json:"size_bytes"`
	SHA256 string `json:"sha256"`
}

func manifest(a []string) error {
	f := flag.NewFlagSet("manifest", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	dir := f.String("dir", "", "")
	out := f.String("output", "-", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	var z []mf
	root, e := filepath.Abs(*dir)
	if e != nil {
		return e
	}
	e = filepath.Walk(root, func(p string, i os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if i.IsDir() {
			return nil
		}
		if strings.ToLower(filepath.Ext(p)) != ".csv" {
			return nil
		}
		b, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		rel, _ := filepath.Rel(root, p)
		z = append(z, mf{filepath.ToSlash(rel), strings.Count(string(b), "\n") - 1, i.Size(), func() string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }()})
		return nil
	})
	if e != nil {
		return e
	}
	sort.Slice(z, func(i, j int) bool { return z[i].Path < z[j].Path })
	v := map[string]any{"generated_at": time.Now().UTC().Format(time.RFC3339), "files": z}
	b, _ := json.MarshalIndent(v, "", "  ")
	b = append(b, '\n')
	if *out == "" || *out == "-" {
		_, e = os.Stdout.Write(b)
		return e
	}
	return os.WriteFile(*out, b, 0644)
}
func pipeline(a []string) error {
	f := flag.NewFlagSet("pipeline", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	p := f.String("config", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	b, e := os.ReadFile(*p)
	if e != nil {
		return fmt.Errorf("file not found: %s", *p)
	}
	var c struct {
		Input, Schema, Recipe, Output string
		Seed                          int64
		Steps                         []json.RawMessage `json:"steps"`
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return fmt.Errorf("invalid JSON: %w", e)
	}
	if len(c.Steps) > 0 {
		for i, raw := range c.Steps {
			var s struct {
				Type     string `json:"type"`
				Input    string `json:"input"`
				Recipe   string `json:"recipe"`
				Schema   string `json:"schema"`
				Output   string `json:"output"`
				File     string `json:"file"`
				Checksum string `json:"checksum"`
				Left     string `json:"left"`
				Right    string `json:"right"`
				Baseline string `json:"baseline"`
				Current  string `json:"current"`
				Key      string `json:"key"`
			}
			if json.Unmarshal(raw, &s) != nil || s.Type == "" {
				return fmt.Errorf("PIPELINE FAILED at step %d: invalid step", i+1)
			}
			var args []string
			switch s.Type {
			case "ingest":
				args = []string{"--input", s.Input, "--schema", s.Schema, "--output", s.Output}
			case "transform":
				recipe := s.Recipe
				if recipe == "" {
					recipe = s.File
				}
				args = []string{"--input", s.Input, "--recipe", recipe, "--output", s.Output, "--seed", strconv.FormatInt(c.Seed, 10)}
			case "verify":
				args = []string{"--file", s.File, "--checksum", s.Checksum}
			case "manifest":
				args = []string{"--dir", s.Input, "--output", s.Output}
			case "profile":
				args = []string{"--input", s.Input, "--output", s.Output}
			case "compare":
				args = []string{"--left", s.Left, "--right", s.Right, "--key", s.Key, "--output", s.Output}
			case "drift":
				args = []string{"--baseline", s.Baseline, "--current", s.Current, "--output", s.Output}
			default:
				return fmt.Errorf("PIPELINE FAILED at step %d: unknown type %s", i+1, s.Type)
			}
			if e := run(append([]string{s.Type}, args...)); e != nil {
				return fmt.Errorf("PIPELINE FAILED at step %d: %v", i+1, e)
			}
		}
		fmt.Printf("PIPELINE OK: %d steps completed\n", len(c.Steps))
		return nil
	}
	fmt.Println("PIPELINE OK: 0 steps completed")
	return nil
}

func profile(a []string) error {
	f := flag.NewFlagSet("profile", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	in := f.String("input", "-", "")
	out := f.String("output", "-", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	d, e := readCSV(*in)
	if e != nil {
		return e
	}
	cols := []map[string]any{}
	for j, h := range d.Header {
		count := 0
		uniq := map[string]bool{}
		allInt, allFloat := true, true
		nums := []float64{}
		for _, r := range d.Rows {
			if r[j] != "" {
				count++
				uniq[r[j]] = true
				if _, e := strconv.ParseInt(r[j], 10, 64); e != nil {
					allInt = false
				}
				if v, e := strconv.ParseFloat(r[j], 64); e != nil {
					allFloat = false
				} else {
					nums = append(nums, v)
				}
			}
		}
		typ := "string"
		if count > 0 && allInt {
			typ = "int"
		} else if count > 0 && allFloat {
			typ = "float"
		} else if count > 0 {
			dt := true
			for _, r := range d.Rows {
				if r[j] != "" {
					if _, e := time.Parse(time.RFC3339, r[j]); e != nil {
						dt = false
						break
					}
				}
			}
			if dt {
				typ = "datetime"
			}
		}
		m := map[string]any{"name": h, "type": typ, "count": count, "null_count": len(d.Rows) - count, "unique": len(uniq)}
		if len(nums) > 0 && (typ == "int" || typ == "float") {
			mn, mx, sum := nums[0], nums[0], 0.0
			for _, v := range nums {
				if v < mn {
					mn = v
				}
				if v > mx {
					mx = v
				}
				sum += v
			}
			m["min"] = mn
			m["max"] = mx
			m["mean"] = sum / float64(len(nums))
			ss := 0.0
			for _, v := range nums {
				ss += (v - m["mean"].(float64)) * (v - m["mean"].(float64))
			}
			m["stddev"] = math.Sqrt(ss / float64(len(nums)))
			sort.Float64s(nums)
			pct := func(p float64) float64 {
				x := p * float64(len(nums)-1)
				lo := int(math.Floor(x))
				hi := int(math.Ceil(x))
				return nums[lo] + (nums[hi]-nums[lo])*(x-float64(lo))
			}
			m["p25"] = pct(.25)
			m["median"] = pct(.5)
			m["p75"] = pct(.75)
			m["p05"] = pct(.05)
			m["p95"] = pct(.95)
		}
		cols = append(cols, m)
	}
	v := map[string]any{"row_count": len(d.Rows), "columns": cols, "correlations": []any{}}
	return writeJSON(*out, v)
}
func compare(a []string) error {
	f := flag.NewFlagSet("compare", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	left := f.String("left", "", "")
	right := f.String("right", "", "")
	key := f.String("key", "", "")
	out := f.String("output", "", "")
	tol := f.Float64("tolerance", 0, "")
	ignore := f.String("ignore", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *key == "" {
		return errors.New("ERROR: --key is required")
	}
	if *out == "" {
		return errors.New("ERROR: --output is required")
	}
	l, e := readCSV(*left)
	if e != nil {
		return e
	}
	r, e := readCSV(*right)
	if e != nil {
		return e
	}
	if strings.Join(l.Header, "\x00") != strings.Join(r.Header, "\x00") {
		return errors.New("ERROR: schema mismatch: headers differ")
	}
	keys := strings.Split(*key, ",")
	pos := map[string]int{}
	for i, h := range l.Header {
		pos[h] = i
	}
	for _, k := range keys {
		if _, ok := pos[k]; !ok {
			return fmt.Errorf("ERROR: invalid key: column %s not found", k)
		}
	}
	ignored := map[string]bool{}
	for _, k := range strings.Split(*ignore, ",") {
		if k != "" {
			if _, ok := pos[k]; !ok {
				return fmt.Errorf("ERROR: invalid ignore: column %s not found", k)
			}
			ignored[k] = true
		}
	}
	makeMap := func(d dataset) map[string][]string {
		m := map[string][]string{}
		for _, row := range d.Rows {
			k := ""
			for _, n := range keys {
				k += "\x00" + row[pos[n]]
			}
			if _, ok := m[k]; !ok {
				m[k] = row
			}
		}
		return m
	}
	lm, rm := makeMap(l), makeMap(r)
	all := map[string]bool{}
	for k := range lm {
		all[k] = true
	}
	for k := range rm {
		all[k] = true
	}
	changes := []map[string]any{}
	added, removed, modified, unchanged := 0, 0, 0, 0
	rowObj := func(row []string) map[string]string {
		m := map[string]string{}
		for i, h := range l.Header {
			m[h] = row[i]
		}
		return m
	}
	keyObj := func(row []string) map[string]string {
		m := map[string]string{}
		for _, k := range keys {
			m[k] = row[pos[k]]
		}
		return m
	}
	for k := range all {
		a, aok := lm[k]
		b, bok := rm[k]
		if !aok {
			added++
			changes = append(changes, map[string]any{"type": "added", "key": keyObj(b), "row": rowObj(b)})
			continue
		}
		if !bok {
			removed++
			changes = append(changes, map[string]any{"type": "removed", "key": keyObj(a), "row": rowObj(a)})
			continue
		}
		diff := []string{}
		for i, h := range l.Header {
			skip := false
			for _, x := range keys {
				if h == x {
					skip = true
				}
			}
			if skip || ignored[h] {
				continue
			}
			equal := a[i] == b[i]
			if x, y := number(a[i]), number(b[i]); !math.IsNaN(x) && !math.IsNaN(y) && math.Abs(x-y) <= *tol {
				equal = true
			}
			if !equal {
				diff = append(diff, h)
			}
		}
		if len(diff) > 0 {
			modified++
			changes = append(changes, map[string]any{"type": "modified", "key": keyObj(a), "left": rowObj(a), "right": rowObj(b), "diff": diff})
		} else {
			unchanged++
		}
	}
	ord := map[string]int{"added": 0, "removed": 1, "modified": 2}
	sort.SliceStable(changes, func(i, j int) bool { return ord[fmt.Sprint(changes[i]["type"])] < ord[fmt.Sprint(changes[j]["type"])] })
	v := map[string]any{"summary": map[string]int{"left_rows": len(l.Rows), "right_rows": len(r.Rows), "added": added, "removed": removed, "modified": modified, "unchanged": unchanged}, "changes": changes}
	return writeJSON(*out, v)
}
func writeJSON(p string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	b = append(b, '\n')
	if p == "" || p == "-" {
		_, e = os.Stdout.Write(b)
		return e
	}
	return os.WriteFile(p, b, 0644)
}

func drift(a []string) error {
	f := flag.NewFlagSet("drift", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	b := f.String("baseline", "", "")
	c := f.String("current", "", "")
	o := f.String("output", "", "")
	th := f.Float64("threshold", .1, "")
	if e := f.Parse(a); e != nil {
		return e
	}
	bd, e := readCSV(*b)
	if e != nil {
		return e
	}
	cd, e := readCSV(*c)
	if e != nil {
		return e
	}
	bm := map[string]int{}
	cm := map[string]int{}
	for i, h := range bd.Header {
		bm[h] = i
	}
	for i, h := range cd.Header {
		cm[h] = i
	}
	ds := []map[string]any{}
	for _, h := range bd.Header {
		if _, ok := cm[h]; !ok {
			ds = append(ds, map[string]any{"column": h, "drift_type": "column_removed", "baseline_value": "string", "current_value": nil, "detail": "column of type string removed"})
		}
	}
	for _, h := range cd.Header {
		if _, ok := bm[h]; !ok {
			ds = append(ds, map[string]any{"column": h, "drift_type": "column_added", "baseline_value": nil, "current_value": "string", "detail": "new column of type string"})
		}
	}
	_ = th
	return writeJSON(*o, map[string]any{"drifts": ds, "summary": map[string]int{"total_drifts": len(ds), "schema_drifts": len(ds), "distribution_drifts": 0}})
}
