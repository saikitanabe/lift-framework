package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/js"
)

var (
	configPath = flag.String("config", "config.json", "Path to configuration file")
)

type JsonConfig struct {
	Files []string `json:"files"`
}

func main() {
	config, err := readConfig(*configPath)
	if err != nil {
		log.Fatalln(err)
	}

	err = doMinify(config.Files)
	if err != nil {
		log.Fatalln("minify error", err)
	}
}

func readConfig(configFile string) (*JsonConfig, error) {
	b, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("read config file failed: %w", err)
	}

	var result JsonConfig
	err = json.Unmarshal(b, &result)
	if err != nil {
		return nil, fmt.Errorf("read config unmarshal failed: %w", err)
	}
	return &result, nil
}

func doMinify(jsfiles []string) error {
	m := minify.New()

	o := js.Minifier{KeepVarNames: true}

	m.AddFuncRegexp(regexp.MustCompile("^(application|text)/(x-)?(java|ecma)script$"), js.Minify)

	for _, in := range jsfiles {
		inFile, err := os.Open(in)
		if err != nil {
			return fmt.Errorf("open input file %s error: %w", in, err)
		}

		path, name, ext := splitFileNameExt(in)
		out := fmt.Sprintf("%s/%s-min%s", path, name, ext)

		outFile, err := os.Create(out)
		if err != nil {
			return fmt.Errorf("create output %s error: %w ", out, err)
		}

		err = o.Minify(m, outFile, inFile, nil)
		if err != nil {
			return fmt.Errorf("minify %s => %s error: %w", in, out, err)
		}
	}

	return nil
}

func splitFileNameExt(output string) (string, string, string) {
	path := filepath.Dir(output)
	filename := filepath.Base(output)
	ext := filepath.Ext(output)
	name := strings.TrimSuffix(filename, ext)

	return path, name, ext
}
