package main

import (
	"bufio"
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

type Row map[string]any
type Table struct {
	Columns []string
	Rows    []Row
}

func main() {
	if len(os.Args) < 2 {
		fail("usage: dpipe <ingest|transform|verify|manifest|pipeline>")
	}
	var err error
	switch os.Args[1] {
	case "ingest":
		err = ingest(os.Args[2:])
	case "transform":
		err = transform(os.Args[2:])
	case "verify":
		err = verify(os.Args[2:])
	case "manifest":
		err = manifest(os.Args[2:])
	case "pipeline":
		err = pipeline(os.Args[2:])
	case "profile":
		err = profile(os.Args[2:])
	case "compare":
		err = compare(os.Args[2:])
	case "drift":
		err = drift(os.Args[2:])
	case "validate":
		err = validate(os.Args[2:])
	default:
		err = fmt.Errorf("unknown command: %s", os.Args[1])
	}
	if err != nil {
		msg := err.Error()
		if os.Args[1] == "pipeline" && strings.HasPrefix(msg, "PIPELINE FAILED at step ") {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if strings.HasPrefix(msg, "MISMATCH ") {
			fmt.Fprintln(os.Stderr, msg)
			os.Exit(1)
		}
		if strings.HasPrefix(msg, "file not found: ") || strings.HasPrefix(msg, "invalid recipe: ") || strings.HasPrefix(msg, "malformed JSON: ") {
			fmt.Fprintln(os.Stderr, "ERROR: "+msg)
			os.Exit(1)
		}
		fail(msg)
	}
}
func fail(s string) { fmt.Fprintln(os.Stderr, "ERROR: "+s); os.Exit(1) }

func readTable(path, format string) (Table, error) {
	var r io.Reader = os.Stdin
	if path != "-" {
		f, e := os.Open(path)
		if e != nil {
			if os.IsNotExist(e) {
				return Table{}, fmt.Errorf("file not found: %s", path)
			}
			return Table{}, e
		}
		defer f.Close()
		r = f
	}
	b, e := io.ReadAll(r)
	if e != nil {
		return Table{}, e
	}
	if format == "" {
		if strings.HasSuffix(path, ".json") {
			format = "json"
		} else {
			format = "csv"
		}
	}
	if format == "json" {
		t, e := fromJSON(b)
		if e != nil {
			return Table{}, fmt.Errorf("malformed JSON: %s", path)
		}
		return t, nil
	}
	return fromCSV(b)
}
func fromCSV(b []byte) (Table, error) {
	c := csv.NewReader(strings.NewReader(string(b)))
	c.TrimLeadingSpace = true
	c.FieldsPerRecord = -1
	h, e := c.Read()
	if e != nil {
		return Table{}, errors.New("empty input")
	}
	t := Table{Columns: h}
	for {
		x, e := c.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return t, fmt.Errorf("invalid csv: %w", e)
		}
		r := Row{}
		for i, k := range h {
			if i < len(x) {
				r[k] = parse(x[i])
			} else {
				r[k] = nil
			}
		}
		t.Rows = append(t.Rows, r)
	}
	return t, nil
}
func fromJSON(b []byte) (Table, error) {
	var v any
	if e := json.Unmarshal(b, &v); e != nil {
		return Table{}, fmt.Errorf("malformed JSON: %w", e)
	}
	a, ok := v.([]any)
	if !ok {
		return Table{}, errors.New("json input must be an array")
	}
	t := Table{}
	for _, x := range a {
		r, ok := x.(map[string]any)
		if !ok {
			return t, errors.New("json rows must be objects")
		}
		for k := range r {
			if !contains(t.Columns, k) {
				t.Columns = append(t.Columns, k)
			}
		}
		t.Rows = append(t.Rows, r)
	}
	return t, nil
}
func parse(s string) any {
	if s == "" {
		return nil
	}
	if i, e := strconv.ParseInt(s, 10, 64); e == nil {
		return i
	}
	if f, e := strconv.ParseFloat(s, 64); e == nil {
		return f
	}
	if s == "true" {
		return true
	}
	if s == "false" {
		return false
	}
	return s
}
func writeTable(t Table, format string) error {
	if format == "json" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		return enc.Encode(t.Rows)
	}
	w := csv.NewWriter(os.Stdout)
	if e := w.Write(t.Columns); e != nil {
		return e
	}
	for _, r := range t.Rows {
		x := make([]string, len(t.Columns))
		for i, k := range t.Columns {
			x[i] = stringify(r[k])
		}
		if e := w.Write(x); e != nil {
			return e
		}
	}
	w.Flush()
	return w.Error()
}
func stringify(v any) string {
	if v == nil {
		return ""
	}
	if f, ok := v.(float64); ok {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}
func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}
func stringList(v any) []string {
	if s, ok := v.(string); ok {
		if s == "" {
			return nil
		}
		return []string{s}
	}
	a, _ := v.([]any)
	out := make([]string, 0, len(a))
	for _, x := range a {
		if m, ok := x.(map[string]any); ok {
			if col, ok := m["column"].(string); ok {
				out = append(out, col)
				continue
			}
			if col, ok := m["name"].(string); ok {
				out = append(out, col)
				continue
			}
		}
		out = append(out, fmt.Sprint(x))
	}
	return out
}
func ingest(a []string) error {
	f := flag.NewFlagSet("ingest", flag.ContinueOnError)
	in := f.String("input", "-", "input file")
	schema := f.String("schema", "", "schema file")
	out := f.String("output", "-", "output file")
	rejected := f.String("rejected", "", "rejected rows file")
	sortBy := f.String("sort", "", "sort column")
	checksum := f.String("checksum", "", "checksum output file")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *schema == "" {
		return errors.New("ingest: --schema is required")
	}
	t, e := readTable(*in, "csv")
	if e != nil {
		if strings.HasPrefix(e.Error(), "file not found: ") {
			return e
		}
		return fmt.Errorf("ingest: %w", e)
	}
	var spec struct {
		Columns []struct {
			Name, Type, Pattern string
			Required, Unique    bool
			Min, Max            *float64
		}
		PrimaryKey []string `json:"primary_key"`
	}
	b, e := os.ReadFile(*schema)
	if e != nil {
		return fmt.Errorf("ingest: %w", e)
	}
	if e = json.Unmarshal(b, &spec); e != nil {
		return fmt.Errorf("ingest: malformed schema: %w", e)
	}
	if len(spec.Columns) > 0 {
		expected := make([]string, len(spec.Columns))
		for i, v := range spec.Columns {
			expected[i] = v.Name
		}
		if len(expected) != len(t.Columns) {
			return errors.New("ingest: schema column count mismatch")
		}
		for i := range expected {
			if expected[i] != t.Columns[i] {
				return fmt.Errorf("ingest: schema column mismatch: %s", t.Columns[i])
			}
		}
	}
	valid, bad := []Row{}, []Row{}
	seen := map[string]bool{}
	for _, r := range t.Rows {
		reason := ""
		for _, c := range spec.Columns {
			v := stringify(r[c.Name])
			if v == "" {
				if c.Required {
					reason = "missing required column: " + c.Name
					break
				}
				continue
			}
			switch c.Type {
			case "int":
				if _, x := strconv.ParseInt(v, 10, 64); x != nil {
					reason = "invalid type for column " + c.Name + ": " + v
				}
			case "float":
				if _, x := strconv.ParseFloat(v, 64); x != nil {
					reason = "invalid type for column " + c.Name + ": " + v
				}
			case "datetime":
				if _, x := time.Parse(time.RFC3339, v); x != nil {
					reason = "invalid type for column " + c.Name + ": " + v
				}
			}
			if reason != "" {
				break
			}
			if c.Min != nil || c.Max != nil {
				n, _ := strconv.ParseFloat(v, 64)
				if c.Min != nil && n < *c.Min || c.Max != nil && n > *c.Max {
					reason = "value out of range for column " + c.Name + ": " + v
					break
				}
			}
			if c.Pattern != "" {
				ok, x := regexp.MatchString(c.Pattern, v)
				if x != nil {
					return fmt.Errorf("ingest: invalid pattern: %s", c.Pattern)
				}
				if !ok {
					reason = "value does not match pattern for column " + c.Name + ": " + v
					break
				}
			}
		}
		if reason == "" {
			for _, c := range spec.Columns {
				if c.Unique {
					k := c.Name + "\x00" + stringify(r[c.Name])
					if seen[k] {
						reason = "duplicate value for unique column: " + c.Name
						break
					}
					seen[k] = true
				}
			}
		}
		if reason == "" {
			valid = append(valid, r)
		} else {
			r["rejection_reason"] = reason
			bad = append(bad, r)
		}
	}
	t.Rows = valid
	if rejected == nil || *rejected == "" {
		*rejected = *out + ".rejected"
	}
	bt := Table{Columns: append(append([]string{}, t.Columns...), "rejection_reason"), Rows: bad}
	if e = saveTable(*rejected, bt); e != nil {
		return e
	}
	if len(spec.PrimaryKey) > 0 {
		sort.SliceStable(t.Rows, func(i, j int) bool {
			for _, key := range spec.PrimaryKey {
				if c := compareTyped(t.Rows[i][key], t.Rows[j][key]); c != 0 {
					return c < 0
				}
			}
			return false
		})
	}
	if *sortBy != "" {
		sort.SliceStable(t.Rows, func(i, j int) bool { return stringify(t.Rows[i][*sortBy]) < stringify(t.Rows[j][*sortBy]) })
	}
	if *out != "-" {
		if e = saveTable(*out, t); e != nil {
			return fmt.Errorf("ingest: %w", e)
		}
	} else if e = writeTable(t, "csv"); e != nil {
		return fmt.Errorf("ingest: %w", e)
	}
	if *checksum != "" {
		sum := sha256.Sum256(mustTableBytes(t))
		if e = os.WriteFile(*checksum, []byte(hex.EncodeToString(sum[:])+"\n"), 0644); e != nil {
			return fmt.Errorf("ingest: %w", e)
		}
	}
	if *checksum == "" {
		sum := sha256.Sum256(mustTableBytes(t))
		if e = os.WriteFile(*out+".sha256", []byte(hex.EncodeToString(sum[:])+"\n"), 0644); e != nil {
			return e
		}
	}
	return nil
	/*
		if *out != "-" {
			return saveTable(*out,t)
		}
		return writeTable(t, "csv") */
}

func mustTableBytes(t Table) []byte {
	var b strings.Builder
	w := csv.NewWriter(&b)
	_ = w.Write(t.Columns)
	for _, r := range t.Rows {
		x := make([]string, len(t.Columns))
		for i, k := range t.Columns {
			x[i] = stringify(r[k])
		}
		_ = w.Write(x)
	}
	w.Flush()
	return []byte(b.String())
}
func saveTable(path string, t Table) error {
	f, e := os.Create(path)
	if e != nil {
		return e
	}
	defer f.Close()
	w := csv.NewWriter(f)
	if e = w.Write(t.Columns); e != nil {
		return e
	}
	for _, r := range t.Rows {
		x := make([]string, len(t.Columns))
		for i, k := range t.Columns {
			x[i] = stringify(r[k])
		}
		if e = w.Write(x); e != nil {
			return e
		}
	}
	w.Flush()
	return w.Error()
}

func transform(a []string) error {
	f := flag.NewFlagSet("transform", flag.ContinueOnError)
	in := f.String("input", "-", "")
	recipe := f.String("recipe", "", "recipe JSON")
	out := f.String("output", "-", "")
	seed := f.Int64("seed", 0, "random seed")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *recipe == "" {
		return errors.New("transform: --recipe is required")
	}
	t, e := readTable(*in, "csv")
	if e != nil {
		return e
	}
	b, e := os.ReadFile(*recipe)
	if e != nil {
		return e
	}
	var r []map[string]any
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if e = dec.Decode(&r); e != nil {
		return fmt.Errorf("malformed JSON: %s", *recipe)
	}
	_ = seed
	for _, o := range r {
		op, _ := o["op"].(string)
		if e = applyRecipe(&t, op, o, *seed); e != nil {
			return e
		}
	}
	if *out == "-" {
		return writeTable(t, "csv")
	}
	if e := saveTable(*out, t); e != nil {
		return e
	}
	sum := sha256.Sum256(mustTableBytes(t))
	return os.WriteFile(*out+".sha256", []byte(hex.EncodeToString(sum[:])+"\n"), 0644)
}

func applyRecipe(t *Table, op string, o map[string]any, seed int64) error {
	s := func(k string) string { v, _ := o[k].(string); return v }
	list := func(k string) string {
		if s, ok := o[k].(string); ok {
			return s
		}
		a, _ := o[k].([]any)
		x := make([]string, len(a))
		for i, v := range a {
			x[i] = fmt.Sprint(v)
		}
		return strings.Join(x, ",")
	}
	switch op {
	case "filter":
		col, cond := s("column"), s("condition")
		if e := columnRequired(*t, col); e != nil {
			return fmt.Errorf("invalid recipe: column %s not found", col)
		}
		th, _ := o["threshold"].(float64)
		x := []Row{}
		for _, r := range t.Rows {
			n, e := strconv.ParseFloat(stringify(r[col]), 64)
			if e != nil {
				continue
			}
			ok := map[string]bool{"gt": n > th, "gte": n >= th, "lt": n < th, "lte": n <= th, "eq": n == th, "neq": n != th}[cond]
			if ok {
				x = append(x, r)
			}
		}
		t.Rows = x
		return nil
	case "derive":
		name, expression := s("name"), s("expression")
		if name == "" || expression == "" {
			return errors.New("invalid recipe: derive requires name and expression")
		}
		for _, row := range t.Rows {
			v, e := eval(expression, row)
			if e != nil {
				return e
			}
			row[name] = v
		}
		if !contains(t.Columns, name) {
			t.Columns = append(t.Columns, name)
		}
		return nil
	case "sample":
		if f, ok := o["fraction"].(float64); ok {
			r := rand.New(rand.NewSource(seed))
			x := []Row{}
			for _, row := range t.Rows {
				if r.Float64() < f {
					x = append(x, row)
				}
			}
			t.Rows = x
			return nil
		}
	case "sort":
		col := s("column")
		if e := columnRequired(*t, col); e != nil {
			return fmt.Errorf("invalid recipe: column %s not found", col)
		}
		desc := s("order") == "desc"
		sort.SliceStable(t.Rows, func(i, j int) bool {
			if desc {
				return compareTyped(t.Rows[i][col], t.Rows[j][col]) > 0
			}
			return compareTyped(t.Rows[i][col], t.Rows[j][col]) < 0
		})
		return nil
	case "rename":
		return apply(t, "rename", s("from")+"="+s("to"))
	case "drop":
		return apply(t, "drop", list("columns"))
	case "unpivot":
		ids, cols := stringList(o["index"]), stringList(o["columns"])
		name := s("name_to")
		if name == "" {
			name = "variable"
		}
		valueName := s("value_to")
		if valueName == "" {
			valueName = s("value_name")
		}
		if valueName == "" {
			valueName = "value"
		}
		for _, c := range append(append([]string{}, ids...), cols...) {
			if e := columnRequired(*t, c); e != nil {
				return fmt.Errorf("invalid recipe: column %s not found", c)
			}
		}
		rows := []Row{}
		for _, r := range t.Rows {
			for _, c := range cols {
				out := Row{name: c}
				out[name] = c
				out[valueName] = r[c]
				for _, id := range ids {
					out[id] = r[id]
				}
				rows = append(rows, out)
			}
		}
		t.Rows = rows
		t.Columns = append(append(append([]string{}, ids...), name), valueName)
		return nil
	case "pivot":
		ids, column, value := stringList(o["index"]), s("column"), s("value")
		if value == "" {
			value = s("values")
		}
		for _, c := range append(append([]string{}, ids...), []string{column, value}...) {
			if e := columnRequired(*t, c); e != nil {
				return fmt.Errorf("invalid recipe: column %s not found", c)
			}
		}
		groups := map[string]Row{}
		pivotValues := map[string]bool{}
		for _, r := range t.Rows {
			parts := make([]string, len(ids))
			for i, id := range ids {
				parts[i] = stringify(r[id])
			}
			key := strings.Join(parts, "\x00")
			if groups[key] == nil {
				groups[key] = Row{}
				for _, id := range ids {
					groups[key][id] = r[id]
				}
			}
			p := stringify(r[column])
			if _, exists := groups[key][p]; !exists {
				groups[key][p] = r[value]
			}
			pivotValues[p] = true
		}
		pivotCols := make([]string, 0, len(pivotValues))
		for p := range pivotValues {
			pivotCols = append(pivotCols, p)
		}
		sort.Strings(pivotCols)
		keys := make([]string, 0, len(groups))
		for k := range groups {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		rows := make([]Row, 0, len(keys))
		for _, k := range keys {
			rows = append(rows, groups[k])
		}
		t.Rows = rows
		t.Columns = append(append([]string{}, ids...), pivotCols...)
		return nil
	case "fill":
		cols := strings.Split(list("columns"), ",")
		strat := s("strategy")
		if strat == "linear" {
			return recipeLinearFill(t, stringList(o["columns"]))
		}
		for _, c := range cols {
			if strings.TrimSpace(c) == "" || !contains(t.Columns, strings.TrimSpace(c)) {
				return fmt.Errorf("invalid recipe: column %s not found", strings.TrimSpace(c))
			}
			if strat == "forward" {
				last := ""
				for _, r := range t.Rows {
					if stringify(r[c]) != "" {
						last = stringify(r[c])
					} else if last != "" {
						r[c] = last
					}
				}
			} else if strat == "backward" {
				last := ""
				for i := len(t.Rows) - 1; i >= 0; i-- {
					if stringify(t.Rows[i][c]) != "" {
						last = stringify(t.Rows[i][c])
					} else if last != "" {
						t.Rows[i][c] = last
					}
				}
			} else {
				for _, r := range t.Rows {
					if stringify(r[c]) == "" {
						r[c] = s("value")
					}
				}
			}
		}
		return nil
	case "aggregate":
		return recipeAggregate(t, o)
	case "join":
		return recipeJoin(t, o)
	case "deduplicate":
		return recipeDeduplicate(t, o)
	case "split":
		return recipeSplit(t, o)
	case "assert":
		expr, _ := o["expression"].(string)
		msg, _ := o["message"].(string)
		for i, r := range t.Rows {
			v, e := eval(expr, r)
			if e != nil || !truth(v) {
				return fmt.Errorf("assertion failed on row %d: %s", i+1, msg)
			}
		}
		return nil
	case "normalize":
		return recipeNormalize(t, o)
	case "encode":
		return recipeEncode(t, o)
	case "hash":
		return recipeHash(t, o)
	case "bin":
		return recipeBin(t, o)
	case "detect":
		return recipeDetect(t, o)
	case "rollup":
		return recipeRollup(t, o)
	case "resample":
		return recipeResample(t, o)
	case "watermark":
		return recipeWatermark(t, o)
	case "checkpoint":
		return recipeCheckpoint(t, o)
	case "crossjoin":
		return recipeCrossjoin(t, o)
	case "window":
		return recipeWindow(t, o)
	default:
		return fmt.Errorf("invalid recipe: unknown operation: %s", op)
	}
	return nil
}

func columnRequired(t Table, name string) error {
	if !contains(t.Columns, name) {
		return fmt.Errorf("column not found: %s", name)
	}
	return nil
}

func recipeAggregate(t *Table, o map[string]any) error {
	group, _ := o["group_by"].(string)
	groupspec := stringList(o["group_by"])
	if len(groupspec) > 0 {
		group = groupspec[0]
	}
	if group == "" {
		group, _ = o["group"].(string)
	}
	if e := columnRequired(*t, group); e != nil {
		return fmt.Errorf("invalid recipe: column %s not found", group)
	}
	if len(groupspec) == 0 {
		groupspec = []string{group}
	}
	for _, g := range groupspec {
		if e := columnRequired(*t, g); e != nil {
			return fmt.Errorf("invalid recipe: column %s not found", g)
		}
	}
	aggs, _ := o["aggregations"].([]any)
	if len(aggs) == 0 {
		return errors.New("aggregate requires aggregations")
	}
	groups := map[string][]Row{}
	order := []string{}
	for _, r := range t.Rows {
		parts := make([]string, len(groupspec))
		for i, g := range groupspec {
			parts[i] = stringify(r[g])
		}
		k := strings.Join(parts, "\x00")
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], r)
	}
	rows := []Row{}
	cols := append([]string{}, groupspec...)
	for _, av := range aggs {
		a, _ := av.(map[string]any)
		name, _ := a["as"].(string)
		fn, _ := a["function"].(string)
		col, _ := a["column"].(string)
		if name == "" {
			name = fn + "_" + col
		}
		cols = append(cols, name)
	}
	for _, k := range order {
		out := Row{}
		for _, g := range groupspec {
			out[g] = groups[k][0][g]
		}
		for _, av := range aggs {
			a, _ := av.(map[string]any)
			col, _ := a["column"].(string)
			fn, _ := a["function"].(string)
			if e := columnRequired(*t, col); e != nil {
				return fmt.Errorf("invalid recipe: column %s not found", col)
			}
			name, _ := a["as"].(string)
			if name == "" {
				name = fn + "_" + col
			}
			var sum float64
			var nums []float64
			for _, r := range groups[k] {
				if n, e := strconv.ParseFloat(stringify(r[col]), 64); e == nil {
					sum += n
					nums = append(nums, n)
				}
			}
			var v any
			switch fn {
			case "count":
				v = int64(0)
				for _, rr := range groups[k] {
					if stringify(rr[col]) != "" {
						v = v.(int64) + 1
					}
				}
			case "sum":
				v = sum
			case "avg", "mean":
				v = math.NaN()
				if len(nums) > 0 {
					v = sum / float64(len(nums))
				}
			case "min":
				v = math.NaN()
				if len(nums) > 0 {
					v = nums[0]
					for _, n := range nums[1:] {
						if n < v.(float64) {
							v = n
						}
					}
				}
			case "max":
				v = math.NaN()
				if len(nums) > 0 {
					v = nums[0]
					for _, n := range nums[1:] {
						if n > v.(float64) {
							v = n
						}
					}
				}
			default:
				return fmt.Errorf("unknown aggregate: %s", fn)
			}
			out[name] = v
		}
		rows = append(rows, out)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		for _, g := range groupspec {
			if a, b := stringify(rows[i][g]), stringify(rows[j][g]); a != b {
				return a < b
			}
		}
		return false
	})
	if having, ok := o["having"].(map[string]any); ok {
		col, _ := having["column"].(string)
		validHaving := false
		for _, av := range aggs {
			a, _ := av.(map[string]any)
			name, _ := a["as"].(string)
			if name == "" {
				fn, _ := a["function"].(string)
				src, _ := a["column"].(string)
				name = fn + "_" + src
			}
			if name == col {
				validHaving = true
			}
		}
		if !validHaving {
			return fmt.Errorf("invalid recipe: having column %s not found", col)
		}
		cond, _ := having["condition"].(string)
		threshold, _ := having["threshold"].(float64)
		filtered := rows[:0]
		for _, row := range rows {
			n, _ := strconv.ParseFloat(stringify(row[col]), 64)
			keep := map[string]bool{"gt": n > threshold, "gte": n >= threshold, "lt": n < threshold, "lte": n <= threshold, "eq": n == threshold, "neq": n != threshold}[cond]
			if keep {
				filtered = append(filtered, row)
			}
		}
		rows = filtered
	} else if having, ok := o["having"].(string); ok && having != "" {
		filtered := rows[:0]
		for _, row := range rows {
			v, e := eval(having, row)
			if e != nil {
				return e
			}
			if truth(v) {
				filtered = append(filtered, row)
			}
		}
		rows = filtered
	}
	t.Columns, t.Rows = cols, rows
	return nil
}

func recipeJoin(t *Table, o map[string]any) error {
	path, _ := o["file"].(string)
	if path == "" {
		path, _ = o["input"].(string)
	}
	if path == "" {
		path, _ = o["right"].(string)
	}
	right, e := readTable(path, "csv")
	if e != nil {
		return e
	}
	leftKey, _ := o["left_on"].(string)
	if leftKey == "" {
		leftKey, _ = o["on"].(string)
	}
	rightKey, _ := o["right_on"].(string)
	if rightKey == "" {
		rightKey = leftKey
	}
	if e = columnRequired(*t, leftKey); e != nil {
		return fmt.Errorf("invalid recipe: join key %s not found in left dataset", leftKey)
	}
	if e = columnRequired(right, rightKey); e != nil {
		return fmt.Errorf("invalid recipe: join key %s not found in right dataset", rightKey)
	}
	how, _ := o["type"].(string)
	if how == "" {
		how, _ = o["how"].(string)
	}
	if how == "" {
		how = "inner"
	}
	index := map[string][]Row{}
	for _, r := range right.Rows {
		k := stringify(r[rightKey])
		index[k] = append(index[k], r)
	}
	cols := append([]string{}, t.Columns...)
	for _, c := range right.Columns {
		if c != rightKey && !contains(cols, c) {
			cols = append(cols, c)
		}
	}
	rows := []Row{}
	matched := map[string]bool{}
	for _, l := range t.Rows {
		rs := index[stringify(l[leftKey])]
		if len(rs) == 0 && how == "left" {
			out := Row{}
			for _, c := range cols {
				out[c] = l[c]
			}
			for _, c := range right.Columns {
				if c != rightKey && !contains(t.Columns, c) {
					out[c] = ""
				}
			}
			rows = append(rows, out)
			continue
		}
		if len(rs) > 1 {
			rs = rs[:1]
		}
		for _, r := range rs {
			out := Row{}
			for k, v := range l {
				out[k] = v
			}
			for k, v := range r {
				if k != rightKey && out[k] == nil {
					out[k] = v
				}
			}
			rows = append(rows, out)
			matched[stringify(l[leftKey])] = true
		}
	}
	if how == "outer" {
		for _, r := range right.Rows {
			k := stringify(r[rightKey])
			if !matched[k] {
				out := Row{}
				for _, c := range t.Columns {
					out[c] = nil
				}
				for k, v := range r {
					if k != rightKey {
						out[k] = v
					}
				}
				rows = append(rows, out)
			}
		}
	}
	t.Columns, t.Rows = cols, rows
	return nil
}

func recipeWindow(t *Table, o map[string]any) error {
	col, _ := o["column"].(string)
	if col == "" {
		col, _ = o["value"].(string)
	}
	if col != "" {
		if e := columnRequired(*t, col); e != nil {
			return e
		}
	}
	name, _ := o["as"].(string)
	if name == "" {
		name, _ = o["name"].(string)
	}
	if name == "" {
		name = "window"
	}
	fn, _ := o["function"].(string)
	if fn == "" {
		fn = "row_number"
	}
	partitions := stringList(o["partition_by"])
	if len(partitions) == 0 {
		partitions = stringList(o["partition"])
	}
	orders := stringList(o["order_by"])
	orderDesc := make([]bool, len(orders))
	if raw, ok := o["order_by"].([]any); ok {
		for i, item := range raw {
			if m, ok := item.(map[string]any); ok {
				order, _ := m["order"].(string)
				orderDesc[i] = strings.EqualFold(order, "desc")
			}
		}
	}
	for _, c := range append(append([]string{}, partitions...), orders...) {
		if e := columnRequired(*t, c); e != nil {
			return e
		}
	}
	groups := map[string][]int{}
	for i, r := range t.Rows {
		key := ""
		for _, c := range partitions {
			key += "\x00" + stringify(r[c])
		}
		groups[key] = append(groups[key], i)
	}
	for _, indices := range groups {
		sort.SliceStable(indices, func(i, j int) bool {
			for n, c := range orders {
				if x := compareTyped(t.Rows[indices[i]][c], t.Rows[indices[j]][c]); x != 0 {
					if orderDesc[n] {
						return x > 0
					}
					return x < 0
				}
			}
			return indices[i] < indices[j]
		})
		counts, sums := 0, 0.0
		var previous []any
		rank := 0
		for pos, i := range indices {
			r := t.Rows[i]
			counts++
			tied := len(previous) == len(orders)
			for j, c := range orders {
				if !tied || compareTyped(r[c], previous[j]) != 0 {
					tied = false
				}
			}
			if !tied {
				rank = pos + 1
				previous = make([]any, len(orders))
				for j, c := range orders {
					previous[j] = r[c]
				}
			}
			switch fn {
			case "row_number":
				r[name] = counts
			case "rank":
				r[name] = rank
			case "count":
				r[name] = counts
			case "sum", "avg", "mean":
				n, _ := strconv.ParseFloat(stringify(r[col]), 64)
				sums += n
				if fn == "sum" {
					r[name] = sums
				} else {
					r[name] = sums / float64(counts)
				}
			default:
				return fmt.Errorf("unknown window function: %s", fn)
			}
		}
	}
	if !contains(t.Columns, name) {
		t.Columns = append(t.Columns, name)
	}
	return nil
}

func recipeLinearFill(t *Table, cols []string) error {
	for _, c := range cols {
		if !contains(t.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
		original := make([]string, len(t.Rows))
		for i, row := range t.Rows {
			original[i] = stringify(row[c])
		}
		for i, r := range t.Rows {
			if stringify(r[c]) != "" {
				continue
			}
			lo, hi := -1, -1
			var lv, hv float64
			for j := i - 1; j >= 0; j-- {
				if v, e := strconv.ParseFloat(original[j], 64); e == nil {
					lo = j
					lv = v
					break
				}
			}
			for j := i + 1; j < len(t.Rows); j++ {
				if v, e := strconv.ParseFloat(original[j], 64); e == nil {
					hi = j
					hv = v
					break
				}
			}
			if lo >= 0 && hi >= 0 {
				r[c] = strconv.FormatFloat(lv+(hv-lv)*float64(i-lo)/float64(hi-lo), 'f', -1, 64)
			} else if lo >= 0 {
				r[c] = strconv.FormatFloat(lv, 'f', -1, 64)
			} else if hi >= 0 {
				r[c] = strconv.FormatFloat(hv, 'f', -1, 64)
			}
		}
	}
	return nil
}
func recipeDeduplicate(t *Table, o map[string]any) error {
	cols := stringList(o["columns"])
	if len(cols) == 0 {
		cols = t.Columns
	}
	for _, c := range cols {
		if !contains(t.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
	}
	keep, _ := o["keep"].(string)
	seen := map[string]bool{}
	out := []Row{}
	if keep == "last" {
		for i := len(t.Rows) - 1; i >= 0; i-- {
			k := rowKey(t.Rows[i], cols)
			if !seen[k] {
				seen[k] = true
				out = append([]Row{t.Rows[i]}, out...)
			}
		}
	} else {
		for _, r := range t.Rows {
			k := rowKey(r, cols)
			if !seen[k] {
				seen[k] = true
				out = append(out, r)
			}
		}
	}
	t.Rows = out
	return nil
}
func rowKey(r Row, cols []string) string {
	p := make([]string, len(cols))
	for i, c := range cols {
		p[i] = stringify(r[c])
	}
	return strings.Join(p, "\x00")
}
func recipeSplit(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	d, _ := o["delimiter"].(string)
	ns := stringList(o["names"])
	ix := -1
	for i, x := range t.Columns {
		if x == c {
			ix = i
		}
	}
	if ix < 0 {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	t.Columns = append(append(append([]string{}, t.Columns[:ix]...), ns...), t.Columns[ix+1:]...)
	for _, r := range t.Rows {
		p := strings.Split(stringify(r[c]), d)
		for len(p) < len(ns) {
			p = append(p, "")
		}
		if len(p) > len(ns) {
			p = append(p[:len(ns)-1], strings.Join(p[len(ns)-1:], d))
		}
		delete(r, c)
		for i, n := range ns {
			r[n] = p[i]
		}
	}
	return nil
}
func recipeNormalize(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	as, _ := o["as"].(string)
	method, _ := o["method"].(string)
	if !contains(t.Columns, c) {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	xs := []float64{}
	for _, r := range t.Rows {
		if n, e := strconv.ParseFloat(stringify(r[c]), 64); e == nil {
			xs = append(xs, n)
		}
	}
	mean := 0.
	for _, n := range xs {
		mean += n
	}
	if len(xs) > 0 {
		mean /= float64(len(xs))
	}
	sd, min, max := 0., math.Inf(1), math.Inf(-1)
	for _, n := range xs {
		sd += (n - mean) * (n - mean)
		if n < min {
			min = n
		}
		if n > max {
			max = n
		}
	}
	if len(xs) > 1 {
		sd = math.Sqrt(sd / float64(len(xs)-1))
	}
	t.Columns = append(t.Columns, as)
	for _, r := range t.Rows {
		n, e := strconv.ParseFloat(stringify(r[c]), 64)
		if e != nil {
			r[as] = ""
			continue
		}
		v := 0.
		if method == "zscore" {
			if sd != 0 {
				v = (n - mean) / sd
			}
		} else if max != min {
			v = (n - min) / (max - min)
		}
		r[as] = strconv.FormatFloat(v, 'f', -1, 64)
	}
	return nil
}
func recipeEncode(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	method, _ := o["method"].(string)
	if !contains(t.Columns, c) {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	vals := map[string]bool{}
	for _, r := range t.Rows {
		if stringify(r[c]) != "" {
			vals[stringify(r[c])] = true
		}
	}
	keys := []string{}
	for v := range vals {
		keys = append(keys, v)
	}
	sort.Strings(keys)
	if method == "ordinal" {
		as, _ := o["as"].(string)
		t.Columns = append(t.Columns, as)
		for _, r := range t.Rows {
			r[as] = ""
			for i, v := range keys {
				if stringify(r[c]) == v {
					r[as] = strconv.Itoa(i)
				}
			}
		}
		return nil
	}
	drop, _ := o["drop"].(bool)
	pos := len(t.Columns)
	if drop {
		for i, x := range t.Columns {
			if x == c {
				pos = i
			}
		}
		t.Columns = append(t.Columns[:pos], t.Columns[pos+1:]...)
	}
	for i, v := range keys {
		n := c + "_" + v
		if drop {
			t.Columns = append(t.Columns[:pos+i], append([]string{n}, t.Columns[pos+i:]...)...)
		} else {
			t.Columns = append(t.Columns, n)
		}
		for _, r := range t.Rows {
			if stringify(r[c]) == v {
				r[n] = "1"
			} else {
				r[n] = "0"
			}
		}
	}
	return nil
}
func recipeHash(t *Table, o map[string]any) error {
	cols := stringList(o["columns"])
	if len(cols) == 0 {
		cols = t.Columns
	}
	for _, c := range cols {
		if !contains(t.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
	}
	as, _ := o["as"].(string)
	t.Columns = append(t.Columns, as)
	for _, r := range t.Rows {
		x := sha256.Sum256([]byte(rowKey(r, cols)))
		r[as] = hex.EncodeToString(x[:])
	}
	return nil
}
func recipeBin(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	as, _ := o["as"].(string)
	n, _ := o["bins"].(float64)
	if n < 1 {
		n = 1
	}
	if !contains(t.Columns, c) {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	xs := []float64{}
	for _, r := range t.Rows {
		if x, e := strconv.ParseFloat(stringify(r[c]), 64); e == nil {
			xs = append(xs, x)
		}
	}
	lo, hi := 0., 0.
	if len(xs) > 0 {
		lo, hi = xs[0], xs[0]
		for _, x := range xs {
			if x < lo {
				lo = x
			}
			if x > hi {
				hi = x
			}
		}
	}
	w := (hi - lo) / n
	t.Columns = append(t.Columns, as)
	for _, r := range t.Rows {
		x, e := strconv.ParseFloat(stringify(r[c]), 64)
		if e != nil {
			r[as] = ""
			continue
		}
		if hi == lo {
			r[as] = fmt.Sprintf("[%s,%s]", strconv.FormatFloat(lo, 'f', -1, 64), strconv.FormatFloat(hi, 'f', -1, 64))
			continue
		}
		i := 0.
		low, high := lo, hi
		if method, _ := o["method"].(string); method == "quantile" {
			sort.Float64s(xs)
			bounds := []float64{}
			for j := 0.; j <= n; j++ {
				z := j / n * float64(len(xs)-1)
				l := int(z)
				u := int(math.Ceil(z))
				bounds = append(bounds, xs[l]+(xs[u]-xs[l])*(z-float64(l)))
			}
			for j := int(n) - 1; j >= 0; j-- {
				if x >= bounds[j] {
					i = float64(j)
					low = bounds[j]
					high = bounds[j+1]
					break
				}
			}
		} else {
			if w > 0 {
				i = math.Floor((x - lo) / w)
				if i >= n {
					i = n - 1
				}
			}
		}
		if method, _ := o["method"].(string); method != "quantile" {
			low, high = lo+i*w, lo+(i+1)*w
			if i == n-1 {
				high = hi
			}
		}
		r[as] = fmt.Sprintf("[%s,%s)", strconv.FormatFloat(low, 'f', -1, 64), strconv.FormatFloat(high, 'f', -1, 64))
		if i == n-1 {
			r[as] = fmt.Sprintf("[%s,%s]", strconv.FormatFloat(low, 'f', -1, 64), strconv.FormatFloat(high, 'f', -1, 64))
		}
	}
	return nil
}
func recipeDetect(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	as, _ := o["as"].(string)
	factor, _ := o["factor"].(float64)
	method, _ := o["method"].(string)
	if !contains(t.Columns, c) {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	xs := []float64{}
	for _, r := range t.Rows {
		if x, e := strconv.ParseFloat(stringify(r[c]), 64); e == nil {
			xs = append(xs, x)
		}
	}
	q1, q3 := 0., 0.
	if method == "iqr" && len(xs) >= 2 {
		sort.Float64s(xs)
		p := func(p float64) float64 {
			z := p * float64(len(xs)-1)
			l := int(z)
			u := int(math.Ceil(z))
			return xs[l] + (xs[u]-xs[l])*(z-float64(l))
		}
		q1, q3 = p(.25), p(.75)
	}
	m := 0.
	for _, x := range xs {
		m += x
	}
	if len(xs) > 0 {
		m /= float64(len(xs))
	}
	sd := 0.
	for _, x := range xs {
		sd += (x - m) * (x - m)
	}
	if len(xs) > 0 {
		sd = math.Sqrt(sd / float64(len(xs)))
	}
	t.Columns = append(t.Columns, as)
	for _, r := range t.Rows {
		x, e := strconv.ParseFloat(stringify(r[c]), 64)
		if e != nil || (method == "iqr" && len(xs) < 2) || (method != "iqr" && sd == 0) {
			r[as] = "0"
		} else if method == "iqr" {
			if x < q1-factor*(q3-q1) || x > q3+factor*(q3-q1) {
				r[as] = "1"
			} else {
				r[as] = "0"
			}
		} else if math.Abs(x-m)/sd > factor {
			r[as] = "1"
		} else {
			r[as] = "0"
		}
	}
	return nil
}
func recipeRollup(t *Table, o map[string]any) error {
	cols := stringList(o["columns"])
	if len(cols) == 0 {
		cols = stringList(o["group_by"])
	}
	for _, c := range cols {
		if !contains(t.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
	}
	aggs, _ := o["aggregations"].([]any)
	outcols := append([]string{}, cols...)
	for _, v := range aggs {
		a := v.(map[string]any)
		n, _ := a["as"].(string)
		outcols = append(outcols, n)
	}
	makeLevel := func(k int) []Row {
		groups := map[string][]Row{}
		for _, r := range t.Rows {
			p := []string{}
			for i := 0; i < k; i++ {
				p = append(p, stringify(r[cols[i]]))
			}
			groups[strings.Join(p, "\x00")] = append(groups[strings.Join(p, "\x00")], r)
		}
		keys := []string{}
		for k := range groups {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		rows := []Row{}
		for _, key := range keys {
			r := Row{}
			p := strings.Split(key, "\x00")
			for i, c := range cols {
				if i < k {
					r[c] = p[i]
				} else {
					r[c] = "*"
				}
			}
			for _, v := range aggs {
				a := v.(map[string]any)
				col, _ := a["column"].(string)
				fn, _ := a["function"].(string)
				name, _ := a["as"].(string)
				nums := []float64{}
				for _, x := range groups[key] {
					if n, e := strconv.ParseFloat(stringify(x[col]), 64); e == nil {
						nums = append(nums, n)
					}
				}
				r[name] = aggregateValue(nums, groups[key], col, fn)
			}
			rows = append(rows, r)
		}
		return rows
	}
	rows := makeLevel(len(cols))
	for k := len(cols) - 1; k >= 1; k-- {
		rows = append(rows, makeLevel(k)...)
	}
	rows = append(rows, makeLevel(0)...)
	t.Columns, t.Rows = outcols, rows
	return nil
}
func aggregateValue(nums []float64, rows []Row, col, fn string) any {
	if fn == "count" {
		n := 0
		for _, r := range rows {
			if stringify(r[col]) != "" {
				n++
			}
		}
		return int64(n)
	}
	if len(nums) == 0 {
		return math.NaN()
	}
	sort.Float64s(nums)
	s := 0.
	for _, n := range nums {
		s += n
	}
	switch fn {
	case "sum":
		return s
	case "avg", "mean":
		return s / float64(len(nums))
	case "min":
		return nums[0]
	case "max":
		return nums[len(nums)-1]
	}
	return math.NaN()
}
func recipeResample(t *Table, o map[string]any) error {
	c, _ := o["column"].(string)
	if !contains(t.Columns, c) {
		return fmt.Errorf("invalid recipe: column %s not found", c)
	}
	g := map[string][]Row{}
	for _, r := range t.Rows {
		g[stringify(r[c])] = append(g[stringify(r[c])], r)
	}
	keys := []string{}
	for k := range g {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	target := len(g[keys[0]])
	for _, k := range keys {
		if o["strategy"] == "oversample" && len(g[k]) > target {
			target = len(g[k])
		}
		if o["strategy"] == "undersample" && len(g[k]) < target {
			target = len(g[k])
		}
	}
	out := []Row{}
	for groupIndex, k := range keys {
		rs := g[k]
		if o["strategy"] == "oversample" {
			for i := 0; i < target; i++ {
				out = append(out, rs[i%len(rs)])
			}
		} else {
			seed := int64(0)
			if v, ok := o["seed"].(float64); ok {
				seed = int64(v) + int64(groupIndex)
			}
			idx := rand.New(rand.NewSource(seed))
			perm := idx.Perm(len(rs))
			chosen := perm[:target]
			sort.Ints(chosen)
			for _, i := range chosen {
				out = append(out, rs[i])
			}
		}
	}
	t.Rows = out
	return nil
}
func recipeWatermark(t *Table, o map[string]any) error {
	cols := stringList(o["columns"])
	if len(cols) == 0 {
		cols = t.Columns
	}
	for _, c := range cols {
		if !contains(t.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
	}
	as, _ := o["as"].(string)
	key, _ := o["key"].(string)
	t.Columns = append(t.Columns, as)
	for _, r := range t.Rows {
		m := hmac.New(sha256.New, []byte(key))
		m.Write([]byte(rowKey(r, cols)))
		r[as] = hex.EncodeToString(m.Sum(nil)[:8])
	}
	return nil
}

func compareTyped(a, b any) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	var af, bf float64
	var an, bn bool
	switch v := a.(type) {
	case int64:
		af = float64(v)
		an = true
	case float64:
		af = v
		an = true
	}
	switch v := b.(type) {
	case int64:
		bf = float64(v)
		bn = true
	case float64:
		bf = v
		bn = true
	}
	if an && bn {
		if af < bf {
			return -1
		}
		if af > bf {
			return 1
		}
		return 0
	}
	sa, sb := stringify(a), stringify(b)
	if sa < sb {
		return -1
	}
	if sa > sb {
		return 1
	}
	return 0
}
func apply(t *Table, op, expr string) error {
	parts := strings.Fields(op)
	name := parts[0]
	arg := strings.TrimSpace(strings.TrimPrefix(op, name))
	arg = strings.TrimSpace(strings.Trim(arg, "()"))
	switch name {
	case "filter":
		var x []Row
		for _, r := range t.Rows {
			v, e := eval(exprOr(arg, expr), r)
			if e != nil {
				return e
			}
			if truth(v) {
				x = append(x, r)
			}
		}
		t.Rows = x
	case "derive":
		p := strings.SplitN(arg, "=", 2)
		if len(p) != 2 {
			return errors.New("derive requires name=expression")
		}
		for _, r := range t.Rows {
			v, e := eval(p[1], r)
			if e != nil {
				return e
			}
			r[strings.TrimSpace(p[0])] = v
		}
		if !contains(t.Columns, strings.TrimSpace(p[0])) {
			t.Columns = append(t.Columns, strings.TrimSpace(p[0]))
		}
	case "rename":
		p := strings.SplitN(arg, "=", 2)
		if len(p) != 2 {
			return errors.New("rename requires old=new")
		}
		old, newn := strings.TrimSpace(p[0]), strings.TrimSpace(p[1])
		for i, k := range t.Columns {
			if k == old {
				t.Columns[i] = newn
			}
		}
		for _, r := range t.Rows {
			r[newn] = r[old]
			delete(r, old)
		}
	case "drop":
		for _, k := range strings.Split(arg, ",") {
			k = strings.TrimSpace(k)
			for i, x := range t.Columns {
				if x == k {
					t.Columns = append(t.Columns[:i], t.Columns[i+1:]...)
					break
				}
			}
			for _, r := range t.Rows {
				delete(r, k)
			}
		}
	case "sample":
		n, e := strconv.Atoi(arg)
		if e != nil {
			return errors.New("sample requires an integer")
		}
		if n < len(t.Rows) {
			t.Rows = t.Rows[:n]
		}
	case "sort":
		key := strings.TrimSpace(arg)
		sort.SliceStable(t.Rows, func(i, j int) bool { return stringify(t.Rows[i][key]) < stringify(t.Rows[j][key]) })
	case "fill":
		p := strings.SplitN(arg, "=", 2)
		if len(p) != 2 {
			return errors.New("fill requires column=value")
		}
		for _, r := range t.Rows {
			if r[strings.TrimSpace(p[0])] == nil {
				r[strings.TrimSpace(p[0])] = parse(strings.TrimSpace(p[1]))
			}
		}
	case "aggregate":
		p := strings.Split(arg, ":")
		if len(p) < 2 {
			return errors.New("aggregate requires group:column:function")
		}
		group, col, fn := strings.TrimSpace(p[0]), strings.TrimSpace(p[1]), "sum"
		if len(p) > 2 {
			fn = strings.TrimSpace(p[2])
		}
		groups := map[string][]Row{}
		order := []string{}
		for _, r := range t.Rows {
			k := stringify(r[group])
			if _, ok := groups[k]; !ok {
				order = append(order, k)
			}
			groups[k] = append(groups[k], r)
		}
		rows := []Row{}
		for _, k := range order {
			rs := groups[k]
			out := Row{group: k}
			var sum float64
			min, max := 0.0, 0.0
			for i, r := range rs {
				n, _ := strconv.ParseFloat(stringify(r[col]), 64)
				sum += n
				if i == 0 || n < min {
					min = n
				}
				if i == 0 || n > max {
					max = n
				}
			}
			var v any
			switch fn {
			case "count":
				v = int64(len(rs))
			case "avg", "mean":
				if len(rs) > 0 {
					v = sum / float64(len(rs))
				}
			case "min":
				v = min
			case "max":
				v = max
			case "sum":
				v = sum
			default:
				return fmt.Errorf("unknown aggregate: %s", fn)
			}
			out[fn+"_"+col] = v
			rows = append(rows, out)
		}
		t.Rows = rows
		t.Columns = []string{group, fn + "_" + col}
	case "unpivot":
		p := strings.SplitN(arg, ":", 3)
		if len(p) < 3 {
			return errors.New("unpivot requires id:value:columns")
		}
		ids, name := strings.Split(p[0], ","), strings.TrimSpace(p[1])
		cols := strings.Split(p[2], ",")
		rows := []Row{}
		for _, r := range t.Rows {
			for _, c := range cols {
				out := Row{name: strings.TrimSpace(c), "value": r[strings.TrimSpace(c)]}
				for _, id := range ids {
					id = strings.TrimSpace(id)
					out[id] = r[id]
				}
				rows = append(rows, out)
			}
		}
		t.Rows = rows
		t.Columns = append([]string{}, ids...)
		t.Columns = append(t.Columns, name, "value")
	case "pivot":
		p := strings.Split(arg, ":")
		if len(p) < 3 {
			return errors.New("pivot requires row:column:value")
		}
		rowKey, colKey, valKey := strings.TrimSpace(p[0]), strings.TrimSpace(p[1]), strings.TrimSpace(p[2])
		by := map[string]Row{}
		cols := []string{rowKey}
		for _, r := range t.Rows {
			k := stringify(r[rowKey])
			if by[k] == nil {
				by[k] = Row{rowKey: r[rowKey]}
			}
			c := stringify(r[colKey])
			by[k][c] = r[valKey]
			if !contains(cols, c) {
				cols = append(cols, c)
			}
		}
		rows := []Row{}
		for _, k := range sortedKeys(by) {
			rows = append(rows, by[k])
		}
		t.Rows = rows
		t.Columns = cols
	default:
		return fmt.Errorf("unknown operation: %s", name)
	}
	return nil
}
func sortedKeys(m map[string]Row) []string {
	a := make([]string, 0, len(m))
	for k := range m {
		a = append(a, k)
	}
	sort.Strings(a)
	return a
}
func exprOr(a, b string) string {
	if b != "" {
		return b
	}
	return a
}
func truth(v any) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if n, ok := v.(float64); ok {
		if math.IsNaN(n) {
			return false
		}
		return n != 0
	}
	return fmt.Sprint(v) != ""
}
func eval(s string, r Row) (any, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, errors.New("empty expression")
	}
	if strings.HasPrefix(s, "(") && matchingParen(s) == len(s)-1 {
		return eval(s[1:len(s)-1], r)
	}
	if i := strings.Index(s, "("); i > 0 && strings.HasSuffix(s, ")") && matchingParen(s[i:]) == len(s[i:])-1 {
		fn, args := strings.ToLower(strings.TrimSpace(s[:i])), splitArgs(s[i+1:len(s)-1])
		vals := []any{}
		for _, a := range args {
			v, e := eval(a, r)
			if e != nil {
				return nil, e
			}
			vals = append(vals, v)
		}
		switch fn {
		case "sqrt":
			n, _ := num(vals, 0)
			if n < 0 {
				return math.NaN(), nil
			}
			return math.Sqrt(n), nil
		case "ceil":
			n, _ := num(vals, 0)
			return math.Ceil(n), nil
		case "floor":
			n, _ := num(vals, 0)
			return math.Floor(n), nil
		case "round":
			n, _ := num(vals, 0)
			p, _ := num(vals, 1)
			q := math.Pow10(int(p))
			if n < 0 {
				return math.Ceil(n*q-0.5) / q, nil
			}
			return math.Floor(n*q+0.5) / q, nil
		case "pow":
			a, _ := num(vals, 0)
			b, _ := num(vals, 1)
			return math.Pow(a, b), nil
		case "log":
			n, _ := num(vals, 0)
			if n <= 0 {
				return math.NaN(), nil
			}
			return math.Log(n), nil
		case "min", "max":
			a, _ := num(vals, 0)
			b, _ := num(vals, 1)
			if fn == "min" && a < b || fn == "max" && a > b {
				return a, nil
			}
			return b, nil
		case "if":
			c, _ := num(vals, 0)
			if c > 0 {
				return vals[1], nil
			}
			return vals[2], nil
		case "clamp":
			x, _ := num(vals, 0)
			lo, _ := num(vals, 1)
			hi, _ := num(vals, 2)
			return math.Min(hi, math.Max(lo, x)), nil
		case "coalesce":
			if !math.IsNaN(mustNum(vals[0])) {
				return vals[0], nil
			}
			return vals[1], nil
		case "lower":
			return strings.ToLower(stringify(vals[0])), nil
		case "upper":
			return strings.ToUpper(stringify(vals[0])), nil
		case "length", "len":
			return int64(len(stringify(vals[0]))), nil
		case "abs":
			n, _ := strconv.ParseFloat(stringify(vals[0]), 64)
			if n < 0 {
				n = -n
			}
			return n, nil
		case "sha256":
			x := sha256.Sum256([]byte(stringify(vals[0])))
			return hex.EncodeToString(x[:]), nil
		default:
			return nil, fmt.Errorf("unknown function: %s", fn)
		}
	}
	if strings.HasPrefix(s, "'") && strings.HasSuffix(s, "'") {
		return strings.Trim(s, "'"), nil
	}
	for _, ops := range [][]string{{"||"}, {"&&"}, {"==", "!=", ">=", "<=", ">", "<"}, {"+", "-"}, {"*", "/", "%"}} {
		for _, op := range ops {
			if p := findOp(s, op); p > 0 {
				a, e := eval(s[:p], r)
				if e != nil {
					return nil, e
				}
				b, e := eval(s[p+len(op):], r)
				if e != nil {
					return nil, e
				}
				return bin(a, b, op)
			}
		}
	}
	if strings.HasPrefix(s, "-") {
		v, e := eval(s[1:], r)
		n, _ := num([]any{v}, 0)
		return -n, e
	}
	if v, ok := r[s]; ok {
		return v, nil
	}
	return parse(s), nil
}
func matchingParen(s string) int {
	d := 0
	for i, c := range s {
		if c == '(' {
			d++
		}
		if c == ')' {
			d--
			if d == 0 {
				return i
			}
		}
	}
	return -1
}
func findOp(s, op string) int {
	d := 0
	for i := 0; i <= len(s)-len(op); i++ {
		if s[i] == '(' {
			d++
		}
		if s[i] == ')' {
			d--
		}
		if d == 0 && i+len(op) <= len(s) && s[i:i+len(op)] == op {
			return i
		}
	}
	return -1
}
func num(v []any, i int) (float64, error) {
	if i >= len(v) {
		return 0, errors.New("missing argument")
	}
	return strconv.ParseFloat(stringify(v[i]), 64)
}
func mustNum(v any) float64 { n, _ := strconv.ParseFloat(stringify(v), 64); return n }

func splitArgs(s string) []string {
	var out []string
	start, depth := 0, 0
	for i, c := range s {
		if c == '(' {
			depth++
		}
		if c == ')' {
			depth--
		}
		if c == ',' && depth == 0 {
			out = append(out, strings.TrimSpace(s[start:i]))
			start = i + 1
		}
	}
	if strings.TrimSpace(s[start:]) != "" {
		out = append(out, strings.TrimSpace(s[start:]))
	}
	return out
}
func bin(a, b any, op string) (any, error) {
	af, _ := strconv.ParseFloat(stringify(a), 64)
	bf, _ := strconv.ParseFloat(stringify(b), 64)
	switch op {
	case "||":
		if af > 0 || bf > 0 {
			return float64(1), nil
		}
		return float64(0), nil
	case "&&":
		if af > 0 && bf > 0 {
			return float64(1), nil
		}
		return float64(0), nil
	case "+":
		return af + bf, nil
	case "-":
		return af - bf, nil
	case "*":
		return af * bf, nil
	case "/":
		if bf == 0 {
			return math.NaN(), nil
		}
		return af / bf, nil
	case "%":
		if bf == 0 {
			return math.NaN(), nil
		}
		return math.Mod(af, bf), nil
	case "==":
		if math.IsNaN(af) || math.IsNaN(bf) {
			return float64(0), nil
		}
		if af == bf {
			return float64(1), nil
		}
		return float64(0), nil
	case "!=":
		if math.IsNaN(af) || math.IsNaN(bf) {
			return float64(0), nil
		}
		if af != bf {
			return float64(1), nil
		}
		return float64(0), nil
	case ">":
		if !math.IsNaN(af) && !math.IsNaN(bf) && af > bf {
			return float64(1), nil
		}
		return float64(0), nil
	case "<":
		if !math.IsNaN(af) && !math.IsNaN(bf) && af < bf {
			return float64(1), nil
		}
		return float64(0), nil
	case ">=":
		if !math.IsNaN(af) && !math.IsNaN(bf) && af >= bf {
			return float64(1), nil
		}
		return float64(0), nil
	case "<=":
		if !math.IsNaN(af) && !math.IsNaN(bf) && af <= bf {
			return float64(1), nil
		}
		return float64(0), nil
	}
	return nil, errors.New("invalid expression")
}

func verify(a []string) error {
	f := flag.NewFlagSet("verify", flag.ContinueOnError)
	in := f.String("file", "", "")
	checksum := f.String("checksum", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *in == "" || *checksum == "" {
		return errors.New("verify: --file and --checksum are required")
	}
	b, e := os.ReadFile(*in)
	if e != nil {
		return e
	}
	want, e := os.ReadFile(*checksum)
	if e != nil {
		if _, hexErr := hex.DecodeString(strings.TrimSpace(*checksum)); hexErr != nil {
			return fmt.Errorf("verify: %w", e)
		}
		want = []byte(*checksum)
	}
	sum := sha256.Sum256(b)
	actual, expected := hex.EncodeToString(sum[:]), strings.TrimSpace(string(want))
	if expected != actual {
		return fmt.Errorf("MISMATCH expected=%s actual=%s", expected, actual)
	}
	fmt.Fprintln(os.Stdout, "VERIFIED")
	return nil
}
func profile(a []string) error {
	f := flag.NewFlagSet("profile", flag.ContinueOnError)
	in := f.String("input", "", "")
	out := f.String("output", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	t, e := readTable(*in, "csv")
	if e != nil {
		return e
	}
	type C struct {
		Name       string  `json:"name"`
		Type       string  `json:"type"`
		Count      int     `json:"count"`
		Null       int     `json:"null_count"`
		Unique     int     `json:"unique"`
		Min        any     `json:"min,omitempty"`
		Max        any     `json:"max,omitempty"`
		Mean       float64 `json:"mean,omitempty"`
		Std        float64 `json:"stddev,omitempty"`
		Median     float64 `json:"median,omitempty"`
		P25        float64 `json:"p25,omitempty"`
		P75        float64 `json:"p75,omitempty"`
		P05        float64 `json:"p05,omitempty"`
		P95        float64 `json:"p95,omitempty"`
		MinLength  int     `json:"min_length,omitempty"`
		MaxLength  int     `json:"max_length,omitempty"`
		AvgLength  float64 `json:"avg_length,omitempty"`
		Earliest   string  `json:"earliest,omitempty"`
		Latest     string  `json:"latest,omitempty"`
		Skewness   any     `json:"skewness"`
		Kurtosis   any     `json:"kurtosis"`
		Mode       any     `json:"mode"`
		Histogram  any     `json:"histogram"`
		MostCommon any     `json:"most_common,omitempty"`
	}
	cs := []C{}
	for _, c := range t.Columns {
		vals := []string{}
		set := map[string]bool{}
		for _, r := range t.Rows {
			v := stringify(r[c])
			if v != "" {
				vals = append(vals, v)
				set[v] = true
			}
		}
		typ := "string"
		allInt := len(vals) > 0
		allFloat := len(vals) > 0
		for _, v := range vals {
			if _, x := strconv.ParseInt(v, 10, 64); x != nil {
				allInt = false
			}
			if _, x := strconv.ParseFloat(v, 64); x != nil {
				allFloat = false
			}
		}
		if allInt {
			typ = "int"
		} else if allFloat {
			typ = "float"
		} else if len(vals) > 0 {
			dt := true
			for _, v := range vals {
				if _, x := time.Parse(time.RFC3339, v); x != nil {
					dt = false
				}
			}
			if dt {
				typ = "datetime"
			}
		}
		q := C{Name: c, Type: typ, Count: len(vals), Null: len(t.Rows) - len(vals), Unique: len(set)}
		if typ == "int" || typ == "float" {
			xs := []float64{}
			for _, v := range vals {
				n, _ := strconv.ParseFloat(v, 64)
				xs = append(xs, n)
			}
			q.Min = xs[0]
			q.Max = xs[0]
			for _, n := range xs {
				if n < q.Min.(float64) {
					q.Min = n
				}
				if n > q.Max.(float64) {
					q.Max = n
				}
				q.Mean += n
			}
			q.Mean /= float64(len(xs))
			for _, n := range xs {
				q.Std += (n - q.Mean) * (n - q.Mean)
			}
			q.Std = math.Sqrt(q.Std / float64(len(xs)))
			sort.Float64s(xs)
			pct := func(p float64) float64 {
				z := p * float64(len(xs)-1)
				lo := int(math.Floor(z))
				hi := int(math.Ceil(z))
				return xs[lo] + (xs[hi]-xs[lo])*(z-float64(lo))
			}
			q.Median = pct(.5)
			q.P25 = pct(.25)
			q.P75 = pct(.75)
			q.P05 = pct(.05)
			q.P95 = pct(.95)
			if len(xs) >= 3 {
				s := math.Sqrt(func() float64 {
					z := 0.
					for _, n := range xs {
						z += (n - q.Mean) * (n - q.Mean)
					}
					return z / float64(len(xs)-1)
				}())
				if s != 0 {
					z := 0.
					for _, n := range xs {
						z += math.Pow((n-q.Mean)/s, 3)
					}
					q.Skewness = float64(len(xs)) / float64((len(xs)-1)*(len(xs)-2)) * z
				}
			}
			if len(xs) >= 4 {
				s := math.Sqrt(func() float64 {
					z := 0.
					for _, n := range xs {
						z += (n - q.Mean) * (n - q.Mean)
					}
					return z / float64(len(xs)-1)
				}())
				if s != 0 {
					z := 0.
					for _, n := range xs {
						z += math.Pow((n-q.Mean)/s, 4)
					}
					q.Kurtosis = float64(len(xs)*(len(xs)+1))/float64((len(xs)-1)*(len(xs)-2)*(len(xs)-3))*z - 3*math.Pow(float64(len(xs)-1), 2)/float64((len(xs)-2)*(len(xs)-3))
				}
			}
			freq := map[float64]int{}
			for _, n := range xs {
				freq[n]++
			}
			best := 0
			var mode float64
			for n, k := range freq {
				if k > best || (k == best && n < mode) {
					best = k
					mode = n
				}
			}
			if best > 1 {
				q.Mode = mode
			}
			bins := []map[string]any{}
			if len(xs) > 0 {
				if xs[0] == xs[len(xs)-1] {
					bins = []map[string]any{{"low": xs[0], "high": xs[0], "count": len(xs)}}
				} else {
					w := (xs[len(xs)-1] - xs[0]) / 10.
					for i := 0; i < 10; i++ {
						cnt := 0
						for _, n := range xs {
							bi := int(math.Floor((n - xs[0]) / w))
							if bi < 0 {
								bi = 0
							}
							if bi > 9 {
								bi = 9
							}
							if bi == i {
								cnt++
							}
						}
						bins = append(bins, map[string]any{"low": xs[0] + float64(i)*w, "high": xs[0] + float64(i+1)*w, "count": cnt})
					}
				}
			}
			q.Histogram = bins
		} else if typ == "string" {
			freq := map[string]int{}
			for _, v := range vals {
				freq[v]++
			}
			type pair struct {
				v string
				n int
			}
			ps := []pair{}
			for v, n := range freq {
				ps = append(ps, pair{v, n})
			}
			sort.Slice(ps, func(i, j int) bool {
				if ps[i].n != ps[j].n {
					return ps[i].n > ps[j].n
				}
				return ps[i].v < ps[j].v
			})
			mc := []map[string]any{}
			for i := 0; i < len(ps) && i < 5; i++ {
				mc = append(mc, map[string]any{"value": ps[i].v, "count": ps[i].n})
			}
			q.MostCommon = mc
			for _, v := range vals {
				q.AvgLength += float64(len(v))
				if q.MinLength == 0 || len(v) < q.MinLength {
					q.MinLength = len(v)
				}
				if len(v) > q.MaxLength {
					q.MaxLength = len(v)
				}
			}
			if len(vals) > 0 {
				q.AvgLength /= float64(len(vals))
			}
		} else if typ == "datetime" {
			var earliest, latest time.Time
			for _, v := range vals {
				dt, _ := time.Parse(time.RFC3339, v)
				if q.Earliest == "" || dt.Before(earliest) {
					earliest = dt
					q.Earliest = dt.Format(time.RFC3339)
				}
				if q.Latest == "" || dt.After(latest) {
					latest = dt
					q.Latest = dt.Format(time.RFC3339)
				}
			}
		}
		cs = append(cs, q)
	}
	cor := []any{}
	numeric := map[string]bool{}
	for _, q := range cs {
		numeric[q.Name] = q.Type == "int" || q.Type == "float"
	}
	for i := 0; i < len(t.Columns); i++ {
		for j := i + 1; j < len(t.Columns); j++ {
			if !numeric[t.Columns[i]] || !numeric[t.Columns[j]] {
				continue
			}
			a, b := []float64{}, []float64{}
			for _, r := range t.Rows {
				x, e1 := strconv.ParseFloat(stringify(r[t.Columns[i]]), 64)
				y, e2 := strconv.ParseFloat(stringify(r[t.Columns[j]]), 64)
				if e1 == nil && e2 == nil {
					a = append(a, x)
					b = append(b, y)
				}
			}
			var cv any
			if len(a) >= 2 {
				ma, mb := 0., 0.
				for k := range a {
					ma += a[k]
					mb += b[k]
				}
				ma /= float64(len(a))
				mb /= float64(len(a))
				nu, da, db := 0., 0., 0.
				for k := range a {
					u, vv := a[k]-ma, b[k]-mb
					nu += u * vv
					da += u * u
					db += vv * vv
				}
				if da*db > 0 {
					cv = nu / math.Sqrt(da*db)
				}
			}
			if cv != nil {
				cor = append(cor, map[string]any{"column_a": t.Columns[i], "column_b": t.Columns[j], "correlation": cv})
			} else {
				cor = append(cor, map[string]any{"column_a": t.Columns[i], "column_b": t.Columns[j], "correlation": nil})
			}
		}
	}
	columns := make([]map[string]any, 0, len(cs))
	for _, q := range cs {
		qb, _ := json.Marshal(q)
		var m map[string]any
		_ = json.Unmarshal(qb, &m)
		if q.Type == "string" {
			delete(m, "skewness")
			delete(m, "kurtosis")
			delete(m, "mode")
			delete(m, "histogram")
			m["min_length"], m["max_length"], m["avg_length"] = q.MinLength, q.MaxLength, q.AvgLength
		} else {
			delete(m, "min_length")
			delete(m, "max_length")
			delete(m, "avg_length")
			delete(m, "most_common")
			if q.Type == "datetime" {
				delete(m, "min")
				delete(m, "max")
				delete(m, "mean")
				delete(m, "stddev")
				delete(m, "median")
				delete(m, "p25")
				delete(m, "p75")
				delete(m, "p05")
				delete(m, "p95")
				delete(m, "skewness")
				delete(m, "kurtosis")
				delete(m, "mode")
				delete(m, "histogram")
			}
		}
		if q.Type == "int" || q.Type == "float" {
			m["mean"], m["stddev"], m["median"], m["p25"], m["p75"], m["p05"], m["p95"] = q.Mean, q.Std, q.Median, q.P25, q.P75, q.P05, q.P95
		}
		columns = append(columns, m)
	}
	v := map[string]any{"row_count": len(t.Rows), "columns": columns, "correlations": cor}
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(*out, append(b, '\n'), 0644)
}
func compare(a []string) error {
	f := flag.NewFlagSet("compare", flag.ContinueOnError)
	l := f.String("left", "", "")
	r := f.String("right", "", "")
	key := f.String("key", "", "")
	out := f.String("output", "", "")
	tol := f.Float64("tolerance", 0, "")
	ignore := f.String("ignore", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *key == "" {
		return errors.New("--key is required")
	}
	if *out == "" {
		return errors.New("--output is required")
	}
	lt, e := readTable(*l, "csv")
	if e != nil {
		return e
	}
	rt, e := readTable(*r, "csv")
	if e != nil {
		return e
	}
	if strings.Join(lt.Columns, ",") != strings.Join(rt.Columns, ",") {
		return errors.New("schema mismatch: headers differ")
	}
	ks := strings.Split(*key, ",")
	for _, c := range ks {
		if !contains(lt.Columns, c) {
			return fmt.Errorf("invalid key: column %s not found", c)
		}
	}
	lm, rm := map[string]Row{}, map[string]Row{}
	for _, x := range lt.Rows {
		k := rowKey(x, ks)
		if _, ok := lm[k]; !ok {
			lm[k] = x
		}
	}
	for _, x := range rt.Rows {
		k := rowKey(x, ks)
		if _, ok := rm[k]; !ok {
			rm[k] = x
		}
	}
	ign := map[string]bool{}
	for _, c := range strings.Split(*ignore, ",") {
		if c != "" {
			if !contains(lt.Columns, c) {
				return fmt.Errorf("invalid ignore: column %s not found", c)
			}
			ign[c] = true
		}
	}
	changes := []any{}
	added, removed := 0, 0
	for k, x := range rm {
		if _, ok := lm[k]; !ok {
			added++
			changes = append(changes, map[string]any{"type": "added", "key": keyObject(x, ks), "row": rowObject(x, lt.Columns)})
		}
	}
	for k, x := range lm {
		if _, ok := rm[k]; !ok {
			removed++
			changes = append(changes, map[string]any{"type": "removed", "key": keyObject(x, ks), "row": rowObject(x, lt.Columns)})
		}
	}
	modified := 0
	unchanged := 0
	for k, lrow := range lm {
		if rrow, ok := rm[k]; ok {
			diff := []string{}
			for _, c := range lt.Columns {
				if contains(ks, c) || ign[c] {
					continue
				}
				a, b := stringify(lrow[c]), stringify(rrow[c])
				af, ea := strconv.ParseFloat(a, 64)
				bf, eb := strconv.ParseFloat(b, 64)
				same := a == b
				if ea == nil && eb == nil {
					same = math.Abs(af-bf) <= *tol
				}
				if !same {
					diff = append(diff, c)
				}
			}
			if len(diff) > 0 {
				modified++
				changes = append(changes, map[string]any{"type": "modified", "key": keyObject(lrow, ks), "left": rowObject(lrow, lt.Columns), "right": rowObject(rrow, lt.Columns), "diff": diff})
			} else {
				unchanged++
			}
		}
	}
	sort.SliceStable(changes, func(i, j int) bool {
		a := changes[i].(map[string]any)
		b := changes[j].(map[string]any)
		rank := map[string]int{"added": 0, "removed": 1, "modified": 2}
		if rank[a["type"].(string)] != rank[b["type"].(string)] {
			return rank[a["type"].(string)] < rank[b["type"].(string)]
		}
		return fmt.Sprint(a["key"]) < fmt.Sprint(b["key"])
	})
	v := map[string]any{"summary": map[string]int{"left_rows": len(lt.Rows), "right_rows": len(rt.Rows), "added": added, "removed": removed, "modified": modified, "unchanged": unchanged}, "changes": changes}
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(*out, append(b, '\n'), 0644)
}

func drift(a []string) error {
	f := flag.NewFlagSet("drift", flag.ContinueOnError)
	b := f.String("baseline", "", "")
	c := f.String("current", "", "")
	out := f.String("output", "", "")
	th := f.Float64("threshold", .1, "")
	if e := f.Parse(a); e != nil {
		return e
	}
	bt, e := readTable(*b, "csv")
	if e != nil {
		if strings.HasPrefix(e.Error(), "invalid csv:") || e.Error() == "empty input" {
			return fmt.Errorf("cannot parse CSV: %s", *b)
		}
		return e
	}
	ct, e := readTable(*c, "csv")
	if e != nil {
		if strings.HasPrefix(e.Error(), "invalid csv:") || e.Error() == "empty input" {
			return fmt.Errorf("cannot parse CSV: %s", *c)
		}
		return e
	}
	type stat struct {
		typ                 string
		count, null, unique int
		min, max, mean, sd  float64
	}
	makeStats := func(t Table) map[string]stat {
		m := map[string]stat{}
		for _, col := range t.Columns {
			s := stat{typ: "string"}
			vals := []float64{}
			set := map[string]bool{}
			allI := true
			allF := true
			for _, r := range t.Rows {
				v := stringify(r[col])
				if v == "" {
					s.null++
					continue
				}
				s.count++
				set[v] = true
				if _, x := strconv.ParseInt(v, 10, 64); x != nil {
					allI = false
				}
				if n, x := strconv.ParseFloat(v, 64); x == nil {
					vals = append(vals, n)
				} else {
					allF = false
				}
			}
			s.unique = len(set)
			if allI && s.count > 0 {
				s.typ = "int"
			} else if allF && s.count > 0 {
				s.typ = "float"
			} else if s.count > 0 {
				datetime := true
				for _, r := range t.Rows {
					v := stringify(r[col])
					if v != "" {
						if _, err := time.Parse(time.RFC3339, v); err != nil {
							datetime = false
							break
						}
					}
				}
				if datetime {
					s.typ = "datetime"
				}
			}
			if s.typ == "int" || s.typ == "float" {
				s.min, s.max = vals[0], vals[0]
				for _, n := range vals {
					s.mean += n
					if n < s.min {
						s.min = n
					}
					if n > s.max {
						s.max = n
					}
				}
				s.mean /= float64(len(vals))
				for _, n := range vals {
					s.sd += (n - s.mean) * (n - s.mean)
				}
				s.sd = math.Sqrt(s.sd / float64(len(vals)))
			}
			m[col] = s
		}
		return m
	}
	bm, cm := makeStats(bt), makeStats(ct)
	names := map[string]bool{}
	for k := range bm {
		names[k] = true
	}
	for k := range cm {
		names[k] = true
	}
	ks := []string{}
	for k := range names {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	dr := []map[string]any{}
	add := func(col, typ string, bv, cv any, d string) {
		dr = append(dr, map[string]any{"column": col, "drift_type": typ, "baseline_value": bv, "current_value": cv, "detail": d})
	}
	for _, col := range ks {
		bs, bo := bm[col]
		cs, co := cm[col]
		if !bo {
			add(col, "column_added", nil, cs.typ, "new column of type "+cs.typ)
			continue
		}
		if !co {
			add(col, "column_removed", bs.typ, nil, "column of type "+bs.typ+" removed")
			continue
		}
		if bs.typ != cs.typ {
			add(col, "type_changed", bs.typ, cs.typ, fmt.Sprintf("type changed from %s to %s", bs.typ, cs.typ))
			continue
		}
		if (bs.typ == "int" || bs.typ == "float") && bs.count > 0 && cs.count > 0 {
			shift := math.Abs(cs.mean-bs.mean) / math.Max(bs.sd, 1e-10)
			if shift > *th {
				add(col, "mean_shift", bs.mean, cs.mean, fmt.Sprintf("normalized shift = %v", shift))
			}
			br := float64(bs.null) / float64(len(bt.Rows))
			cr := float64(cs.null) / float64(len(ct.Rows))
			if math.Abs(cr-br) > *th {
				add(col, "null_rate_change", br, cr, fmt.Sprintf("null rate changed from %v to %v", br, cr))
			}
			brange := bs.max - bs.min
			crange := cs.max - cs.min
			if crange > brange*(1+*th) {
				add(col, "range_expansion", brange, crange, fmt.Sprintf("range expanded from %v to %v", brange, crange))
			}
			ur := float64(bs.unique) / float64(bs.count)
			uc := float64(cs.unique) / float64(cs.count)
			if math.Abs(uc-ur) > *th {
				add(col, "unique_ratio_change", ur, uc, fmt.Sprintf("unique ratio changed from %v to %v", ur, uc))
			}
		}
	}
	order := map[string]int{"column_added": 0, "column_removed": 1, "type_changed": 2, "mean_shift": 3, "null_rate_change": 4, "range_expansion": 5, "unique_ratio_change": 6}
	sort.Slice(dr, func(i, j int) bool {
		if dr[i]["column"] != dr[j]["column"] {
			return dr[i]["column"].(string) < dr[j]["column"].(string)
		}
		return order[dr[i]["drift_type"].(string)] < order[dr[j]["drift_type"].(string)]
	})
	schema := 0
	for _, d := range dr {
		if order[d["drift_type"].(string)] < 3 {
			schema++
		}
	}
	v := map[string]any{"drifts": dr, "summary": map[string]int{"total_drifts": len(dr), "schema_drifts": schema, "distribution_drifts": len(dr) - schema}}
	x, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(*out, append(x, '\n'), 0644)
}
func rowObject(r Row, cols []string) map[string]string {
	o := map[string]string{}
	for _, c := range cols {
		o[c] = stringify(r[c])
	}
	return o
}
func keyObject(r Row, cols []string) map[string]string { return rowObject(r, cols) }
func manifest(a []string) error {
	f := flag.NewFlagSet("manifest", flag.ContinueOnError)
	in := f.String("dir", ".", "")
	out := f.String("output", "-", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	files := []string{}
	e := filepath.Walk(*in, func(p string, i os.FileInfo, e error) error {
		if e == nil && !i.IsDir() && strings.HasSuffix(strings.ToLower(p), ".csv") {
			files = append(files, p)
		}
		return e
	})
	if e != nil {
		return fmt.Errorf("manifest: %w", e)
	}
	sort.Strings(files)
	var w io.Writer = os.Stdout
	var f2 *os.File
	if *out != "-" {
		f2, e = os.Create(*out)
		if e != nil {
			return e
		}
		defer f2.Close()
		w = f2
	}
	type entry struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Rows   int    `json:"rows"`
		Size   int    `json:"size_bytes"`
	}
	entries := []entry{}
	for _, p := range files {
		b, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		s := sha256.Sum256(b)
		rt, _ := fromCSV(b)
		entries = append(entries, entry{filepath.ToSlash(strings.TrimPrefix(p, *in+string(os.PathSeparator))), hex.EncodeToString(s[:]), len(rt.Rows), len(b)})
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(map[string]any{"generated_at": time.Now().UTC().Format(time.RFC3339), "files": entries})
}
func recipeCheckpoint(t *Table, o map[string]any) error {
	as, _ := o["as"].(string)
	alg, _ := o["algorithm"].(string)
	if as == "" || (alg != "row_hash" && alg != "row_number") {
		return errors.New("invalid recipe: invalid checkpoint")
	}
	t.Columns = append(t.Columns, as)
	for i, r := range t.Rows {
		if alg == "row_number" {
			r[as] = strconv.Itoa(i + 1)
			continue
		}
		h := sha256.Sum256([]byte(strings.Join(func() []string {
			x := make([]string, len(t.Columns)-1)
			for j, c := range t.Columns[:len(t.Columns)-1] {
				x[j] = stringify(r[c])
			}
			return x
		}(), "|")))
		r[as] = hex.EncodeToString(h[:])[:8]
	}
	return nil
}

func recipeCrossjoin(t *Table, o map[string]any) error {
	rightPath, _ := o["right"].(string)
	r, err := readTable(rightPath, "csv")
	if err != nil {
		return err
	}
	cols := stringList(o["columns"])
	if len(cols) == 0 {
		cols = append([]string{}, r.Columns...)
	}
	for _, c := range cols {
		if !contains(r.Columns, c) {
			return fmt.Errorf("invalid recipe: column %s not found", c)
		}
	}
	left := append([]string{}, t.Columns...)
	outcols := append(left, cols...)
	rows := []Row{}
	for _, l := range t.Rows {
		for _, rr := range r.Rows {
			x := Row{}
			for _, c := range left {
				x[c] = l[c]
			}
			for _, c := range cols {
				x[c] = rr[c]
			}
			rows = append(rows, x)
		}
	}
	t.Columns, t.Rows = outcols, rows
	return nil
}

func validate(a []string) error {
	f := flag.NewFlagSet("validate", flag.ContinueOnError)
	in := f.String("input", "", "")
	schemaPath := f.String("schema", "", "")
	out := f.String("output", "", "")
	if e := f.Parse(a); e != nil {
		return e
	}
	t, e := readTable(*in, "csv")
	if e != nil {
		return e
	}
	b, e := os.ReadFile(*schemaPath)
	if e != nil {
		if os.IsNotExist(e) {
			return fmt.Errorf("file not found: %s", *schemaPath)
		}
		return e
	}
	var s struct {
		Columns map[string]struct {
			Type     string   `json:"type"`
			Min      *float64 `json:"min"`
			Max      *float64 `json:"max"`
			Required bool     `json:"required"`
			Pattern  string   `json:"pattern"`
			Unique   bool     `json:"unique"`
			Enum     []string `json:"enum"`
		} `json:"columns"`
		Strict bool `json:"strict"`
	}
	if json.Unmarshal(b, &s) != nil {
		return fmt.Errorf("invalid schema: %s", *schemaPath)
	}
	type V struct {
		Column  string `json:"column"`
		Row     any    `json:"row"`
		Rule    string `json:"rule"`
		Value   any    `json:"value"`
		Message string `json:"message"`
	}
	vs := []V{}
	strictViolations := []V{}
	present := map[string]bool{}
	for _, c := range t.Columns {
		if _, ok := s.Columns[c]; ok {
			present[c] = true
		}
	}
	for _, c := range t.Columns {
		sc, ok := s.Columns[c]
		if !ok {
			if s.Strict {
				strictViolations = append(strictViolations, V{c, nil, "strict", nil, fmt.Sprintf("column %q not defined in schema", c)})
			}
			continue
		}
		seen := map[string]int{}
		for i, r := range t.Rows {
			v := stringify(r[c])
			var n float64
			var ne error
			if v != "" && sc.Type == "float" {
				n, ne = strconv.ParseFloat(v, 64)
			}
			if v != "" && sc.Type == "int" {
				_, ne = strconv.ParseInt(v, 10, 64)
			}
			if v != "" && ne != nil {
				vs = append(vs, V{c, i + 2, "type", v, fmt.Sprintf("expected %s, got %q", sc.Type, v)})
			}
			if v == "" && sc.Required {
				vs = append(vs, V{c, i + 2, "required", nil, "value is required"})
			}
			if v != "" && ne == nil && (sc.Type == "int" || sc.Type == "float") {
				if sc.Min != nil && n < *sc.Min {
					vs = append(vs, V{c, i + 2, "min", v, fmt.Sprintf("value %s is below minimum %v", v, *sc.Min)})
				}
				if sc.Max != nil && n > *sc.Max {
					vs = append(vs, V{c, i + 2, "max", v, fmt.Sprintf("value %s exceeds maximum %v", v, *sc.Max)})
				}
			}
			if sc.Pattern != "" && v != "" && sc.Type == "string" {
				if !regexp.MustCompile(sc.Pattern).MatchString(v) {
					vs = append(vs, V{c, i + 2, "pattern", v, fmt.Sprintf("value %q does not match pattern %s", v, sc.Pattern)})
				}
			}
			if len(sc.Enum) > 0 && v != "" && !contains(sc.Enum, v) {
				vs = append(vs, V{c, i + 2, "enum", v, fmt.Sprintf("value %q is not in allowed values [%s]", v, strings.Join(sc.Enum, ", "))})
			}
			if sc.Unique && v != "" {
				if first, ok := seen[v]; ok {
					vs = append(vs, V{c, nil, "unique", v, fmt.Sprintf("duplicate value %q (first at row %d, repeated at row %d)", v, first, i+2)})
				} else {
					seen[v] = i + 2
				}
			}
		}
	}
	for c := range s.Columns {
		if !present[c] && !contains(t.Columns, c) {
			vs = append(vs, V{c, nil, "column_missing", nil, fmt.Sprintf("column %q defined in schema but missing from data", c)})
		}
	}
	vs = append(vs, strictViolations...)
	result := map[string]any{"valid": len(vs) == 0, "violations": vs, "summary": map[string]int{"total_violations": len(vs), "columns_checked": len(present), "rows_checked": len(t.Rows)}}
	raw, _ := json.MarshalIndent(result, "", "  ")
	raw = append(raw, '\n')
	return os.WriteFile(*out, raw, 0644)
}

func pipeline(a []string) error {
	f := flag.NewFlagSet("pipeline", flag.ContinueOnError)
	config := f.String("config", "", "pipeline JSON")
	if e := f.Parse(a); e != nil {
		return e
	}
	if *config == "" {
		return errors.New("pipeline: --config is required")
	}
	b, e := os.ReadFile(*config)
	if e != nil {
		return fmt.Errorf("pipeline: %w", e)
	}
	var p struct {
		Seed  int64 `json:"seed"`
		Steps []struct {
			Type      string  `json:"type"`
			Recipe    string  `json:"recipe"`
			Op        string  `json:"op"`
			Expr      string  `json:"expr"`
			Input     string  `json:"input"`
			Schema    string  `json:"schema"`
			Output    string  `json:"output"`
			File      string  `json:"file"`
			Checksum  string  `json:"checksum"`
			Dir       string  `json:"dir"`
			Baseline  string  `json:"baseline"`
			Current   string  `json:"current"`
			Threshold float64 `json:"threshold"`
			Left      string  `json:"left"`
			Right     string  `json:"right"`
			Key       string  `json:"key"`
		} `json:"steps"`
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if e = dec.Decode(&p); e != nil {
		return fmt.Errorf("pipeline: malformed config: %w", e)
	}
	for i, s := range p.Steps {
		args := []string{}
		for _, x := range [][2]string{{"--input", s.Input}, {"--schema", s.Schema}, {"--output", s.Output}, {"--recipe", s.Recipe}, {"--file", s.File}, {"--checksum", s.Checksum}, {"--dir", s.Dir}} {
			if x[1] != "" {
				args = append(args, x[0], x[1])
			}
		}
		if s.Type == "transform" || s.Type == "" {
			args = append(args, "--seed", strconv.FormatInt(p.Seed, 10))
		}
		var se error
		switch s.Type {
		case "ingest":
			se = ingest(args)
		case "transform", "":
			if s.Op != "" {
				se = fmt.Errorf("transform step does not support op: %s", s.Op)
			} else {
				se = transform(args)
			}
		case "verify":
			se = verify(args)
		case "manifest":
			se = manifest(args)
		case "profile":
			se = profile(args)
		case "compare":
			se = compare(append(args, "--left", s.Left, "--right", s.Right, "--key", s.Key))
		case "drift":
			th := s.Threshold
			if th == 0 {
				th = .1
			}
			se = drift([]string{"--baseline", s.Baseline, "--current", s.Current, "--output", s.Output, "--threshold", strconv.FormatFloat(th, 'f', -1, 64)})
		case "validate":
			se = validate(args)
		default:
			se = fmt.Errorf("unknown step type: %s", s.Type)
		}
		if se != nil {
			return fmt.Errorf("PIPELINE FAILED at step %d: %w", i+1, se)
		}
	}
	fmt.Fprintf(os.Stdout, "PIPELINE OK: %d steps completed\n", len(p.Steps))
	return nil
}

var _ = bufio.NewReader
var _ = regexp.MustCompile
