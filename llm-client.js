#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * LLM Client - Interface to LLM engines with tool execution support
 * Supports ask mode (readonly) and agent mode (full access)
 */

// Configuration
const LLM_ENGINES_FILE = path.join(__dirname, 'llm-engines.json');
const TOOLS_FILE = path.join(__dirname, 'b__d.tools.json');
const SYSTEM_PROMPT_FILE = path.join(__dirname, 'b__d.system.prompt');
const READONLY_PROMPT_FILE = path.join(__dirname, 'b__d.readonly.prompt');
const DEFAULT_MODEL = 'openrouter/gemini-3-pro-preview';

/**
 * Read and parse JSON file
 */
function readJSON(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to read ${filePath}: ${error.message}`);
    }
}

/**
 * Read text file
 */
function readTextFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new Error(`Failed to read ${filePath}: ${error.message}`);
    }
}

/**
 * Read API key from file
 */
function readAPIKey(keyPath) {
    const fullPath = path.isAbsolute(keyPath) ? keyPath : path.join(__dirname, keyPath);
    try {
        const key = fs.readFileSync(fullPath, 'utf8').trim();
        return key;
    } catch (error) {
        throw new Error(`Failed to read API key from ${keyPath}: ${error.message}`);
    }
}

/**
 * LLM Client class
 */
class LLMClient extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.model = options.model || DEFAULT_MODEL;
        this.mode = options.mode || 'agent'; // 'ask' or 'agent'
        this.maxIterations = options.maxIterations || 100;
        
        // Hooks
        this.onRequest = options.onRequest || null;
        this.onResponse = options.onResponse || null;
        this.onToolStdout = options.onToolStdout || null;
        this.onToolStderr = options.onToolStderr || null;
        
        // Load configurations
        this.engines = readJSON(LLM_ENGINES_FILE);
        this.allTools = readJSON(TOOLS_FILE);
        this.systemPrompt = readTextFile(SYSTEM_PROMPT_FILE);
        this.readonlyPrompt = readTextFile(READONLY_PROMPT_FILE);
        
        // Filter tools based on mode
        this.tools = this.filterTools(this.allTools, this.mode);
        
        // Tool registry for execution
        this.toolRegistry = new Map();
        this.registerTools();
    }

    /**
     * Filter tools based on mode
     */
    filterTools(tools, mode) {
        if (mode === 'ask') {
            return tools.filter(tool => {
                const func = tool.function || tool;
                return !func.disallow_in_ask_mode;
            });
        }
        return tools;
    }

    /**
     * Register tools for execution
     * This creates a mapping from tool names to execution functions
     */
    registerTools() {
        // This is a placeholder - actual tool execution would need to be implemented
        // based on the specific tool implementations
        for (const tool of this.allTools) {
            const func = tool.function || tool;
            const toolName = func.name;
            
            // Register tool execution handler
            this.toolRegistry.set(toolName, async (args) => {
                return await this.executeTool(toolName, args, tool);
            });
        }
    }

    /**
     * Execute a tool
     */
    async executeTool(toolName, args, toolDef) {
        const func = toolDef.function || toolDef;
        
        // Emit tool execution start
        this.emit('tool:start', { toolName, args });
        
        try {
            let result;
            
            // Handle different tool types
            switch (toolName) {
                case 'run_terminal_cmd':
                    result = await this.executeTerminalCommand(args);
                    break;
                case 'read_file':
                    result = await this.executeReadFile(args);
                    break;
                case 'grep':
                    result = await this.executeGrep(args);
                    break;
                case 'list_dir':
                    result = await this.executeListDir(args);
                    break;
                case 'glob_file_search':
                    result = await this.executeGlobFileSearch(args);
                    break;
                case 'read_lints':
                    result = await this.executeReadLints(args);
                    break;
                case 'web_search':
                    result = await this.executeWebSearch(args);
                    break;
                case 'update_memory':
                    result = await this.executeUpdateMemory(args);
                    break;
                case 'todo_write':
                    result = await this.executeTodoWrite(args);
                    break;
                case 'edit_file':
                    result = await this.executeEditFile(args);
                    break;
                case 'delete_file':
                    result = await this.executeDeleteFile(args);
                    break;
                case 'llm_chat':
                    result = await this.executeLLMChat(args);
                    break;
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
            
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute terminal command with streaming
     */
    async executeTerminalCommand(args) {
        return new Promise((resolve, reject) => {
            const { command, is_background = false } = args;
            
            if (is_background) {
                // Background execution
                const child = spawn('sh', ['-c', command], {
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
                resolve({ pid: child.pid, status: 'background' });
                return;
            }
            
            // Foreground execution with streaming
            const child = spawn('sh', ['-c', command], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                if (this.onToolStdout) {
                    this.onToolStdout(text);
                }
                this.emit('tool:stdout', { toolName: 'run_terminal_cmd', data: text });
            });
            
            child.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                if (this.onToolStderr) {
                    this.onToolStderr(text);
                }
                this.emit('tool:stderr', { toolName: 'run_terminal_cmd', data: text });
            });
            
            child.on('close', (code) => {
                resolve({
                    exitCode: code,
                    stdout,
                    stderr
                });
            });
            
            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Execute read_file tool
     */
    async executeReadFile(args) {
        const toolName = 'read_file';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { target_file, offset, limit } = args;
            const fullPath = path.isAbsolute(target_file) ? target_file : path.join(process.cwd(), target_file);
            
            let content = fs.readFileSync(fullPath, 'utf8');
            
            if (offset !== undefined || limit !== undefined) {
                const lines = content.split('\n');
                const start = offset || 0;
                const end = limit ? start + limit : lines.length;
                content = lines.slice(start, end).join('\n');
            }
            
            const result = { content };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute grep tool using ripgrep
     */
    async executeGrep(args) {
        const toolName = 'grep';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { pattern, path: searchPath, glob, type, output_mode = 'content', 
                    '-B': beforeLines, '-A': afterLines, '-C': contextLines, 
                    '-i': caseInsensitive, head_limit, multiline } = args;
            
            // Build ripgrep command
            const rgArgs = [pattern];
            
            if (searchPath) {
                rgArgs.push(searchPath);
            }
            
            if (glob) {
                rgArgs.push('--glob', glob);
            }
            
            if (type) {
                rgArgs.push('--type', type);
            }
            
            if (beforeLines !== undefined) {
                rgArgs.push('-B', String(beforeLines));
            }
            
            if (afterLines !== undefined) {
                rgArgs.push('-A', String(afterLines));
            }
            
            if (contextLines !== undefined) {
                rgArgs.push('-C', String(contextLines));
            }
            
            if (caseInsensitive) {
                rgArgs.push('-i');
            }
            
            if (multiline) {
                rgArgs.push('-U', '--multiline-dotall');
            }
            
            if (output_mode === 'files_with_matches') {
                rgArgs.push('-l');
            } else if (output_mode === 'count') {
                rgArgs.push('-c');
            }
            
            if (head_limit !== undefined) {
                rgArgs.push('--max-count', String(head_limit));
            }
            
            return new Promise((resolve, reject) => {
                const child = spawn('rg', rgArgs, {
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                
                let stdout = '';
                let stderr = '';
                
                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                child.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                child.on('close', (code) => {
                    // ripgrep returns 0 for matches, 1 for no matches, 2 for errors
                    if (code === 2) {
                        const error = stderr || 'ripgrep error';
                        this.emit('tool:error', { toolName, args, error });
                        reject(new Error(`ripgrep error: ${error}`));
                        return;
                    }
                    
                    const result = {
                        content: stdout,
                        matches: code === 0
                    };
                    
                    this.emit('tool:complete', { toolName, args, result });
                    resolve(result);
                });
                
                child.on('error', (error) => {
                    this.emit('tool:error', { toolName, args, error: error.message });
                    reject(new Error(`Failed to execute ripgrep: ${error.message}. Make sure ripgrep (rg) is installed.`));
                });
            });
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute list_dir tool
     */
    async executeListDir(args) {
        const toolName = 'list_dir';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { target_directory, ignore_globs = [] } = args;
            const fullPath = target_directory
                ? (path.isAbsolute(target_directory) ? target_directory : path.join(process.cwd(), target_directory))
                : process.cwd();
            
            // Process ignore globs - prepend **/ if not starting with **/
            const processedIgnores = ignore_globs.map(glob => {
                if (!glob.startsWith('**/')) {
                    return '**/' + glob;
                }
                return glob;
            });
            
            const items = fs.readdirSync(fullPath, { withFileTypes: true });
            const resultItems = [];
            
            for (const item of items) {
                // Skip dot files and directories
                if (item.name.startsWith('.')) {
                    continue;
                }
                
                // Check ignore globs
                let shouldIgnore = false;
                const relativePath = path.relative(fullPath, path.join(fullPath, item.name)).replace(/\\/g, '/');
                
                function globToRegex(glob) {
                    // Convert glob pattern to regex
                    // First escape all special regex characters except * ? and .
                    let regex = glob
                        .replace(/\\/g, '\\\\')
                        .replace(/\^/g, '\\^')
                        .replace(/\$/g, '\\$')
                        .replace(/\+/g, '\\+')
                        .replace(/\[/g, '\\[')
                        .replace(/\]/g, '\\]')
                        .replace(/\{/g, '\\{')
                        .replace(/\}/g, '\\}')
                        .replace(/\(/g, '\\(')
                        .replace(/\)/g, '\\)')
                        .replace(/\|/g, '\\|');
                    
                    // Handle glob special characters
                    regex = regex
                        .replace(/\*\*/g, '__DOUBLE_STAR__')
                        .replace(/\*/g, '[^/]*')
                        .replace(/__DOUBLE_STAR__/g, '.*')
                        .replace(/\?/g, '[^/]');
                    
                    // Escape dots after handling * and ? (so dots in character classes aren't escaped)
                    regex = regex.replace(/\./g, '\\.');
                    
                    return new RegExp('^' + regex + '$');
                }
                
                for (const ignoreGlob of processedIgnores) {
                    const regex = globToRegex(ignoreGlob);
                    
                    if (regex.test(relativePath) || regex.test(item.name)) {
                        shouldIgnore = true;
                        break;
                    }
                }
                
                if (!shouldIgnore) {
                    resultItems.push({
                        name: item.name,
                        type: item.isDirectory() ? 'directory' : 'file'
                    });
                }
            }
            
            const result = { items: resultItems };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute glob_file_search tool
     */
    async executeGlobFileSearch(args) {
        const toolName = 'glob_file_search';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { glob_pattern, target_directory } = args;
            const baseDir = target_directory 
                ? (path.isAbsolute(target_directory) ? target_directory : path.join(process.cwd(), target_directory))
                : process.cwd();
            
            // Convert glob pattern - prepend **/ if not starting with **/
            let searchPattern = glob_pattern;
            if (!searchPattern.startsWith('**/') && !searchPattern.startsWith('/')) {
                searchPattern = '**/' + searchPattern;
            }
            
            // Simple glob implementation using recursive directory traversal
            const results = [];
            const patternParts = searchPattern.split('**');
            const hasRecursive = patternParts.length > 1;
            
            function globToRegex(glob) {
                // Convert glob pattern to regex
                // First escape all special regex characters except * ? and .
                let regex = glob
                    .replace(/\\/g, '\\\\')
                    .replace(/\^/g, '\\^')
                    .replace(/\$/g, '\\$')
                    .replace(/\+/g, '\\+')
                    .replace(/\[/g, '\\[')
                    .replace(/\]/g, '\\]')
                    .replace(/\{/g, '\\{')
                    .replace(/\}/g, '\\}')
                    .replace(/\(/g, '\\(')
                    .replace(/\)/g, '\\)')
                    .replace(/\|/g, '\\|');
                
                // Handle glob special characters
                regex = regex
                    .replace(/\*\*/g, '__DOUBLE_STAR__')
                    .replace(/\*/g, '[^/]*')
                    .replace(/__DOUBLE_STAR__/g, '.*')
                    .replace(/\?/g, '[^/]');
                
                // Escape dots after handling * and ? (so dots in character classes aren't escaped)
                regex = regex.replace(/\./g, '\\.');
                
                return new RegExp('^' + regex + '$');
            }
            
            const regexPattern = globToRegex(searchPattern);
            
            function walkDir(dir, depth = 0, maxDepth = 100) {
                if (depth > maxDepth) return;
                
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
                        
                        if (entry.isDirectory()) {
                            if (hasRecursive || depth === 0) {
                                walkDir(fullPath, depth + 1, maxDepth);
                            }
                        } else if (entry.isFile()) {
                            // Test against relative path and filename
                            if (regexPattern.test(relativePath) || regexPattern.test(entry.name)) {
                                try {
                                    const stats = fs.statSync(fullPath);
                                    results.push({
                                        path: fullPath,
                                        mtime: stats.mtime.getTime()
                                    });
                                } catch (e) {
                                    // Skip files we can't stat
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Skip directories we can't read
                }
            }
            
            walkDir(baseDir);
            
            // Sort by modification time (most recent first)
            results.sort((a, b) => b.mtime - a.mtime);
            
            const filePaths = results.map(r => r.path);
            const result = { files: filePaths };
            
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute read_lints tool
     * Supports 50+ languages: JavaScript/TypeScript (ESLint), Python (pylint/flake8), Ruby (rubocop), Rust (clippy), Go (go vet),
     * Shell (shellcheck), YAML (yamllint), Markdown (markdownlint), CSS (stylelint), HTML (htmlhint), SQL (sqlfluff),
     * Lua (luacheck), Java (checkstyle), C/C++ (cppcheck), PHP (phpcs), Swift (swiftlint), Kotlin (ktlint), Dart (dart),
     * JSON, XML (xmllint), TOML (taplo), Dockerfile (hadolint), Terraform (tflint), PowerShell (PSScriptAnalyzer),
     * R (lintr), Perl (perlcritic), Scala (scalastyle), Clojure (clj-kondo), Haskell (hlint), Erlang (elvis),
     * Elixir (credo), OCaml (ocaml-lint), F#/C# (dotnet), Groovy (CodeNarc), Objective-C (OCLint), D (dscanner),
     * Nim (nim check), Crystal (ameba), Zig (zig fmt), Julia (Lint.jl), Fortran (gfortran), COBOL (cobc),
     * Ada (gnat), VHDL (ghdl), Verilog (verilator), Makefile (checkmake), CMake (cmake-lint), and more.
     */
    async executeReadLints(args) {
        const toolName = 'read_lints';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { paths = [] } = args;
            const allLints = [];
            
            // Determine files to lint
            const filesToLint = await this.collectFilesToLint(paths);
            
            // Group files by language/linter
            const filesByLinter = this.groupFilesByLinter(filesToLint);
            
            // Run linters for each group
            for (const [linterType, files] of Object.entries(filesByLinter)) {
                if (files.length === 0) continue;
                
                try {
                    const lints = await this.runLinter(linterType, files);
                    allLints.push(...lints);
                } catch (error) {
                    // If a linter fails, log warning but continue with others
                    console.warn(`Linter ${linterType} failed:`, error.message);
                }
            }
            
            const result = { lints: allLints };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }
    
    /**
     * Collect files to lint based on paths
     */
    async collectFilesToLint(paths) {
        const files = new Set();
        const workspaceRoot = process.cwd();
        
        if (paths.length === 0) {
            // No paths provided - lint all files in workspace (but be selective)
            // Only lint common source file types
            const extensions = [
                // JavaScript/TypeScript
                '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
                // Python
                '.py', '.pyw', '.pyi',
                // Ruby
                '.rb', '.rake',
                // Rust
                '.rs',
                // Go
                '.go',
                // Shell/Bash
                '.sh', '.bash', '.zsh', '.fish',
                // YAML
                '.yaml', '.yml',
                // Markdown
                '.md', '.markdown',
                // CSS
                '.css', '.scss', '.sass', '.less',
                // HTML
                '.html', '.htm',
                // SQL
                '.sql',
                // Lua
                '.lua',
                // Java
                '.java',
                // C/C++
                '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx',
                // PHP
                '.php', '.phtml',
                // Swift
                '.swift',
                // Kotlin
                '.kt', '.kts',
                // Dart
                '.dart',
                // JSON
                '.json',
                // XML
                '.xml',
                // TOML
                '.toml',
                // INI/Config
                '.ini', '.cfg', '.conf',
                // PowerShell
                '.ps1', '.psm1', '.psd1',
                // R
                '.r', '.R',
                // MATLAB
                '.m',
                // Perl
                '.pl', '.pm',
                // Scala
                '.scala',
                // Clojure
                '.clj', '.cljs', '.cljc',
                // Haskell
                '.hs', '.lhs',
                // Erlang
                '.erl', '.hrl',
                // Elixir
                '.ex', '.exs',
                // OCaml
                '.ml', '.mli',
                // F#
                '.fs', '.fsi', '.fsx',
                // C#
                '.cs',
                // VB.NET
                '.vb',
                // Groovy
                '.groovy', '.gvy',
                // Objective-C
                '.m', '.mm',
                // D
                '.d',
                // Nim
                '.nim',
                // Crystal
                '.cr',
                // Zig
                '.zig',
                // V
                '.v',
                // Tcl
                '.tcl',
                // Racket
                '.rkt',
                // Scheme
                '.scm', '.ss',
                // Common Lisp
                '.lisp', '.lsp', '.cl',
                // Prolog
                '.pl', '.pro',
                // Julia
                '.jl',
                // Fortran
                '.f', '.f90', '.f95', '.f03', '.f08',
                // COBOL
                '.cob', '.cbl',
                // Ada
                '.adb', '.ads',
                // VHDL
                '.vhd', '.vhdl',
                // Verilog
                '.v', '.sv',
                // Makefile
                '.mk', '.make',
                // CMake
                '.cmake',
                // Dockerfile (no extension, handled separately)
                // Terraform
                '.tf', '.tfvars',
                // HCL
                '.hcl',
                // YANG
                '.yang'
            ];
            await this.collectFilesRecursive(workspaceRoot, files, extensions);
            await this.collectDockerfiles(workspaceRoot, files);
        } else {
            // Process provided paths
            for (const inputPath of paths) {
                const fullPath = path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath);
                
                if (!fs.existsSync(fullPath)) {
                    continue;
                }
                
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                    files.add(fullPath);
                } else if (stat.isDirectory()) {
                    const extensions = [
                        '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.pyw', '.pyi', '.rb', '.rake', '.rs', '.go',
                        '.sh', '.bash', '.zsh', '.fish', '.yaml', '.yml', '.md', '.markdown', '.css', '.scss', '.sass', '.less',
                        '.html', '.htm', '.sql', '.lua', '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx',
                        '.php', '.phtml', '.swift', '.kt', '.kts', '.dart', '.json', '.xml', '.toml', '.tf', '.tfvars',
                        '.ps1', '.psm1', '.psd1', '.r', '.R', '.pl', '.pm', '.scala', '.clj', '.cljs', '.cljc',
                        '.hs', '.lhs', '.erl', '.hrl', '.ex', '.exs', '.ml', '.mli', '.fs', '.fsi', '.fsx', '.cs',
                        '.groovy', '.gvy', '.m', '.mm', '.d', '.nim', '.cr', '.zig', '.jl', '.f', '.f90', '.f95', '.f03', '.f08',
                        '.cob', '.cbl', '.adb', '.ads', '.vhd', '.vhdl', '.v', '.sv', '.mk', '.make', '.cmake'
                    ];
                    await this.collectFilesRecursive(fullPath, files, extensions);
                    await this.collectDockerfiles(fullPath, files);
                }
            }
        }
        
        return Array.from(files);
    }
    
    /**
     * Recursively collect files with specified extensions
     */
    async collectFilesRecursive(dir, files, extensions) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            // Skip node_modules, .git, and other common ignored directories
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
                continue;
            }
            
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.collectFilesRecursive(fullPath, files, extensions);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (extensions.includes(ext)) {
                    files.add(fullPath);
                }
            }
        }
    }
    
    /**
     * Recursively collect Dockerfile files (no extension)
     */
    async collectDockerfiles(dir, files) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            // Skip node_modules, .git, and other common ignored directories
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
                continue;
            }
            
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                await this.collectDockerfiles(fullPath, files);
            } else if (entry.isFile()) {
                const fileName = entry.name.toLowerCase();
                if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) {
                    files.add(fullPath);
                }
            }
        }
    }
    
    /**
     * Group files by appropriate linter
     */
    groupFilesByLinter(files) {
        const groups = {
            eslint: [],      // JavaScript/TypeScript
            python: [],      // Python
            ruby: [],       // Ruby
            rust: [],       // Rust
            go: [],         // Go
            shell: [],      // Shell/Bash
            yaml: [],       // YAML
            markdown: [],   // Markdown
            css: [],        // CSS/SCSS/SASS
            html: [],       // HTML
            sql: [],        // SQL
            lua: [],        // Lua
            java: [],       // Java
            cpp: [],        // C/C++
            php: [],        // PHP
            swift: [],      // Swift
            kotlin: [],    // Kotlin
            dart: [],       // Dart
            json: [],       // JSON
            xml: [],        // XML
            toml: [],       // TOML
            dockerfile: [], // Dockerfile
            terraform: [],  // Terraform
            powershell: [], // PowerShell
            r: [],          // R
            perl: [],       // Perl
            scala: [],      // Scala
            clojure: [],    // Clojure
            haskell: [],    // Haskell
            erlang: [],     // Erlang
            elixir: [],     // Elixir
            ocaml: [],      // OCaml
            fsharp: [],     // F#
            csharp: [],     // C#
            groovy: [],     // Groovy
            objectivec: [], // Objective-C
            d: [],          // D
            nim: [],        // Nim
            crystal: [],    // Crystal
            zig: [],        // Zig
            julia: [],      // Julia
            fortran: [],    // Fortran
            cobol: [],      // COBOL
            ada: [],        // Ada
            vhdl: [],       // VHDL
            verilog: [],    // Verilog
            makefile: [],   // Makefile
            cmake: []       // CMake
        };
        
        for (const file of files) {
            const fileName = path.basename(file).toLowerCase();
            const ext = path.extname(file);
            const extLower = ext.toLowerCase();
            
            // Check for Dockerfile (no extension)
            if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) {
                groups.dockerfile.push(file);
            }
            // JavaScript/TypeScript
            else if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extLower)) {
                groups.eslint.push(file);
            }
            // Python
            else if (['.py', '.pyw', '.pyi'].includes(extLower)) {
                groups.python.push(file);
            }
            // Ruby
            else if (['.rb', '.rake'].includes(extLower)) {
                groups.ruby.push(file);
            }
            // Rust
            else if (['.rs'].includes(extLower)) {
                groups.rust.push(file);
            }
            // Go
            else if (['.go'].includes(extLower)) {
                groups.go.push(file);
            }
            // Shell/Bash
            else if (['.sh', '.bash', '.zsh', '.fish'].includes(extLower)) {
                groups.shell.push(file);
            }
            // YAML
            else if (['.yaml', '.yml'].includes(extLower)) {
                groups.yaml.push(file);
            }
            // Markdown
            else if (['.md', '.markdown'].includes(extLower)) {
                groups.markdown.push(file);
            }
            // CSS
            else if (['.css', '.scss', '.sass', '.less'].includes(extLower)) {
                groups.css.push(file);
            }
            // HTML
            else if (['.html', '.htm'].includes(extLower)) {
                groups.html.push(file);
            }
            // SQL
            else if (['.sql'].includes(extLower)) {
                groups.sql.push(file);
            }
            // Lua
            else if (['.lua'].includes(extLower)) {
                groups.lua.push(file);
            }
            // Java
            else if (['.java'].includes(extLower)) {
                groups.java.push(file);
            }
            // C/C++
            else if (['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'].includes(extLower)) {
                groups.cpp.push(file);
            }
            // PHP
            else if (['.php', '.phtml'].includes(extLower)) {
                groups.php.push(file);
            }
            // Swift
            else if (['.swift'].includes(extLower)) {
                groups.swift.push(file);
            }
            // Kotlin
            else if (['.kt', '.kts'].includes(extLower)) {
                groups.kotlin.push(file);
            }
            // Dart
            else if (['.dart'].includes(extLower)) {
                groups.dart.push(file);
            }
            // JSON
            else if (['.json'].includes(extLower)) {
                groups.json.push(file);
            }
            // XML
            else if (['.xml'].includes(extLower)) {
                groups.xml.push(file);
            }
            // TOML
            else if (['.toml'].includes(extLower)) {
                groups.toml.push(file);
            }
            // Terraform
            else if (['.tf', '.tfvars'].includes(extLower)) {
                groups.terraform.push(file);
            }
            // PowerShell
            else if (['.ps1', '.psm1', '.psd1'].includes(extLower)) {
                groups.powershell.push(file);
            }
            // R
            else if (['.r', '.R'].includes(extLower)) {
                groups.r.push(file);
            }
            // Perl
            else if (['.pl', '.pm'].includes(extLower)) {
                groups.perl.push(file);
            }
            // Scala
            else if (['.scala'].includes(extLower)) {
                groups.scala.push(file);
            }
            // Clojure
            else if (['.clj', '.cljs', '.cljc'].includes(extLower)) {
                groups.clojure.push(file);
            }
            // Haskell
            else if (['.hs', '.lhs'].includes(extLower)) {
                groups.haskell.push(file);
            }
            // Erlang
            else if (['.erl', '.hrl'].includes(extLower)) {
                groups.erlang.push(file);
            }
            // Elixir
            else if (['.ex', '.exs'].includes(extLower)) {
                groups.elixir.push(file);
            }
            // OCaml
            else if (['.ml', '.mli'].includes(extLower)) {
                groups.ocaml.push(file);
            }
            // F#
            else if (['.fs', '.fsi', '.fsx'].includes(extLower)) {
                groups.fsharp.push(file);
            }
            // C#
            else if (['.cs'].includes(extLower)) {
                groups.csharp.push(file);
            }
            // Groovy
            else if (['.groovy', '.gvy'].includes(extLower)) {
                groups.groovy.push(file);
            }
            // Objective-C
            else if (['.m', '.mm'].includes(extLower)) {
                groups.objectivec.push(file);
            }
            // D
            else if (['.d'].includes(extLower)) {
                groups.d.push(file);
            }
            // Nim
            else if (['.nim'].includes(extLower)) {
                groups.nim.push(file);
            }
            // Crystal
            else if (['.cr'].includes(extLower)) {
                groups.crystal.push(file);
            }
            // Zig
            else if (['.zig'].includes(extLower)) {
                groups.zig.push(file);
            }
            // Julia
            else if (['.jl'].includes(extLower)) {
                groups.julia.push(file);
            }
            // Fortran
            else if (['.f', '.f90', '.f95', '.f03', '.f08'].includes(extLower)) {
                groups.fortran.push(file);
            }
            // COBOL
            else if (['.cob', '.cbl'].includes(extLower)) {
                groups.cobol.push(file);
            }
            // Ada
            else if (['.adb', '.ads'].includes(extLower)) {
                groups.ada.push(file);
            }
            // VHDL
            else if (['.vhd', '.vhdl'].includes(extLower)) {
                groups.vhdl.push(file);
            }
            // Verilog
            else if (['.v', '.sv'].includes(extLower)) {
                groups.verilog.push(file);
            }
            // Makefile
            else if (['.mk', '.make'].includes(extLower) || fileName === 'makefile') {
                groups.makefile.push(file);
            }
            // CMake
            else if (['.cmake'].includes(extLower)) {
                groups.cmake.push(file);
            }
        }
        
        return groups;
    }
    
    /**
     * Run appropriate linter for files
     */
    async runLinter(linterType, files) {
        switch (linterType) {
            case 'eslint':
                return await this.runESLint(files);
            case 'python':
                return await this.runPythonLinter(files);
            case 'ruby':
                return await this.runRubyLinter(files);
            case 'rust':
                return await this.runRustLinter(files);
            case 'go':
                return await this.runGoLinter(files);
            case 'shell':
                return await this.runShellLinter(files);
            case 'yaml':
                return await this.runYAMLLinter(files);
            case 'markdown':
                return await this.runMarkdownLinter(files);
            case 'css':
                return await this.runCSSLinter(files);
            case 'html':
                return await this.runHTMLLinter(files);
            case 'sql':
                return await this.runSQLLinter(files);
            case 'lua':
                return await this.runLuaLinter(files);
            case 'java':
                return await this.runJavaLinter(files);
            case 'cpp':
                return await this.runCppLinter(files);
            case 'php':
                return await this.runPHPLinter(files);
            case 'swift':
                return await this.runSwiftLinter(files);
            case 'kotlin':
                return await this.runKotlinLinter(files);
            case 'dart':
                return await this.runDartLinter(files);
            case 'json':
                return await this.runJSONLinter(files);
            case 'xml':
                return await this.runXMLLinter(files);
            case 'toml':
                return await this.runTOMLLinter(files);
            case 'dockerfile':
                return await this.runDockerfileLinter(files);
            case 'terraform':
                return await this.runTerraformLinter(files);
            case 'powershell':
                return await this.runPowerShellLinter(files);
            case 'r':
                return await this.runRLinter(files);
            case 'perl':
                return await this.runPerlLinter(files);
            case 'scala':
                return await this.runScalaLinter(files);
            case 'clojure':
                return await this.runClojureLinter(files);
            case 'haskell':
                return await this.runHaskellLinter(files);
            case 'erlang':
                return await this.runErlangLinter(files);
            case 'elixir':
                return await this.runElixirLinter(files);
            case 'ocaml':
                return await this.runOCamlLinter(files);
            case 'fsharp':
                return await this.runFSharpLinter(files);
            case 'csharp':
                return await this.runCSharpLinter(files);
            case 'groovy':
                return await this.runGroovyLinter(files);
            case 'objectivec':
                return await this.runObjectiveCLinter(files);
            case 'd':
                return await this.runDLinter(files);
            case 'nim':
                return await this.runNimLinter(files);
            case 'crystal':
                return await this.runCrystalLinter(files);
            case 'zig':
                return await this.runZigLinter(files);
            case 'julia':
                return await this.runJuliaLinter(files);
            case 'fortran':
                return await this.runFortranLinter(files);
            case 'cobol':
                return await this.runCOBOLLinter(files);
            case 'ada':
                return await this.runAdaLinter(files);
            case 'vhdl':
                return await this.runVHDLLinter(files);
            case 'verilog':
                return await this.runVerilogLinter(files);
            case 'makefile':
                return await this.runMakefileLinter(files);
            case 'cmake':
                return await this.runCMakeLinter(files);
            default:
                return [];
        }
    }
    
    /**
     * Run ESLint on JavaScript/TypeScript files
     */
    async runESLint(files) {
        const lints = [];
        
        try {
            // Run ESLint with JSON format
            const eslintPath = path.join(__dirname, 'node_modules', '.bin', 'eslint');
            const configPath = this.findESLintConfig();
            const args = files.concat(['--format', 'json']);
            
            if (configPath) {
                args.push('--config', configPath);
            }
            
            const result = await this.runCommand(eslintPath, args, { timeout: 30000, allowNonZero: true });
            
            // ESLint exits with non-zero code when there are linting errors, but that's OK
            // Parse the JSON output from stdout (stderr may contain warnings but JSON is in stdout)
            try {
                const output = result.stdout || result.stderr || '[]';
                // ESLint may output multiple JSON objects, try to parse as array or single object
                const eslintResults = output.trim().startsWith('[') 
                    ? JSON.parse(output) 
                    : [JSON.parse(output.trim())];
                
                for (const fileResult of eslintResults) {
                    if (fileResult.messages && fileResult.messages.length > 0) {
                        for (const message of fileResult.messages) {
                            lints.push({
                                file: fileResult.filePath,
                                line: message.line || 0,
                                column: message.column || 0,
                                endLine: message.endLine || message.line || 0,
                                endColumn: message.endColumn || message.column || 0,
                                severity: message.severity === 2 ? 'error' : message.severity === 1 ? 'warning' : 'info',
                                message: message.message,
                                rule: message.ruleId || 'unknown',
                                linter: 'eslint'
                            });
                        }
                    }
                }
            } catch (parseError) {
                // If parsing fails, ESLint might not be properly configured
                // Silently return empty results
            }
        } catch (error) {
            // ESLint not available or failed - return empty results
        }
        
        return lints;
    }
    
    /**
     * Find ESLint config file
     */
    findESLintConfig() {
        const possibleConfigs = [
            'eslint.config.js',
            'eslint.config.mjs',
            'eslint.config.cjs',
            '.eslintrc.js',
            '.eslintrc.json',
            '.eslintrc.yml',
            '.eslintrc.yaml'
        ];
        
        for (const config of possibleConfigs) {
            const configPath = path.join(process.cwd(), config);
            if (fs.existsSync(configPath)) {
                return configPath;
            }
        }
        
        // Return path to a default minimal config if none exists
        return null;
    }
    
    /**
     * Run Python linter (pylint or flake8)
     */
    async runPythonLinter(files) {
        const lints = [];
        
        // Try pylint first, then flake8
        for (const linterCmd of ['pylint', 'flake8']) {
            try {
                const result = await this.runCommand(linterCmd, files, { timeout: 30000 });
                
                // Parse pylint/flake8 output (format: file:line:column: message)
                const lines = (result.stdout || result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+):(\d+):(\d*):?\s*(.*)$/);
                    if (match) {
                        const [, file, lineNum, col, message] = match;
                        lints.push({
                            file: path.resolve(file),
                            line: parseInt(lineNum) || 0,
                            column: parseInt(col) || 0,
                            endLine: parseInt(lineNum) || 0,
                            endColumn: parseInt(col) || 0,
                            severity: 'error', // Python linters typically report errors
                            message: message.trim(),
                            rule: linterCmd,
                            linter: linterCmd
                        });
                    }
                }
                
                if (lints.length > 0) break; // Use first linter that produces results
            } catch (error) {
                // Try next linter
                continue;
            }
        }
        
        return lints;
    }
    
    /**
     * Run Ruby linter (rubocop)
     */
    async runRubyLinter(files) {
        const lints = [];
        
        try {
            const result = await this.runCommand('rubocop', ['--format', 'json', ...files], { timeout: 30000 });
            
            try {
                const rubocopResults = JSON.parse(result.stdout || '{}');
                
                for (const [filePath, fileData] of Object.entries(rubocopResults.files || {})) {
                    for (const offense of fileData.offenses || []) {
                        lints.push({
                            file: path.resolve(filePath),
                            line: offense.location.start_line || offense.line || 0,
                            column: offense.location.start_column || offense.column || 0,
                            endLine: offense.location.last_line || offense.line || 0,
                            endColumn: offense.location.last_column || offense.column || 0,
                            severity: offense.severity || 'warning',
                            message: offense.message || '',
                            rule: offense.cop_name || 'unknown',
                            linter: 'rubocop'
                        });
                    }
                }
            } catch (parseError) {
                // Parse failed
            }
        } catch (error) {
            // Rubocop not available
        }
        
        return lints;
    }
    
    /**
     * Run Rust linter (clippy)
     */
    async runRustLinter(files) {
        const lints = [];
        
        try {
            // Clippy works on Rust projects, not individual files
            // Try to find Cargo.toml and run clippy on the project
            const cargoToml = this.findNearestFile('Cargo.toml', files[0]);
            if (cargoToml) {
                const projectDir = path.dirname(cargoToml);
                const result = await this.runCommand('cargo', ['clippy', '--message-format', 'json'], {
                    cwd: projectDir,
                    timeout: 60000
                });
                
                // Parse cargo clippy JSON output (one JSON object per line)
                const lines = (result.stdout || '').split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const clippyResult = JSON.parse(line);
                            if (clippyResult.message && clippyResult.message.level) {
                                const msg = clippyResult.message;
                                const span = msg.spans && msg.spans[0] ? msg.spans[0] : {};
                                
                                lints.push({
                                    file: span.file_name ? path.join(projectDir, span.file_name) : '',
                                    line: span.line_start || 0,
                                    column: span.column_start || 0,
                                    endLine: span.line_end || span.line_start || 0,
                                    endColumn: span.column_end || span.column_start || 0,
                                    severity: msg.level === 'error' ? 'error' : msg.level === 'warning' ? 'warning' : 'info',
                                    message: msg.message || '',
                                    rule: msg.code ? msg.code.code : 'unknown',
                                    linter: 'clippy'
                                });
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }
        } catch (error) {
            // Clippy not available
        }
        
        return lints;
    }
    
    /**
     * Run Go linter (go vet)
     */
    async runGoLinter(files) {
        const lints = [];
        
        try {
            // go vet works on packages, not individual files
            // Group files by directory and run go vet on each package
            const filesByDir = {};
            for (const file of files) {
                const dir = path.dirname(file);
                if (!filesByDir[dir]) {
                    filesByDir[dir] = [];
                }
                filesByDir[dir].push(file);
            }
            
            for (const [dir, dirFiles] of Object.entries(filesByDir)) {
                try {
                    const result = await this.runCommand('go', ['vet', './...'], {
                        cwd: dir,
                        timeout: 30000
                    });
                    
                    // Parse go vet output (format: file:line:column: message)
                    const lines = (result.stdout || result.stderr || '').split('\n');
                    for (const line of lines) {
                        const match = line.match(/^([^:]+):(\d+):(\d*):?\s*(.*)$/);
                        if (match) {
                            const [, file, lineNum, col, message] = match;
                            lints.push({
                                file: path.resolve(dir, file),
                                line: parseInt(lineNum) || 0,
                                column: parseInt(col) || 0,
                                endLine: parseInt(lineNum) || 0,
                                endColumn: parseInt(col) || 0,
                                severity: 'error',
                                message: message.trim(),
                                rule: 'govet',
                                linter: 'govet'
                            });
                        }
                    }
                } catch (error) {
                    // Skip directories where go vet fails
                    continue;
                }
            }
        } catch (error) {
            // go vet not available
        }
        
        return lints;
    }
    
    /**
     * Run Shell linter (shellcheck)
     */
    async runShellLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('shellcheck', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const shellcheckResults = JSON.parse(output);
                for (const fileResult of Array.isArray(shellcheckResults) ? shellcheckResults : [shellcheckResults]) {
                    for (const comment of fileResult.comments || []) {
                        lints.push({
                            file: fileResult.file || '',
                            line: comment.line || 0,
                            column: comment.column || 0,
                            endLine: comment.endLine || comment.line || 0,
                            endColumn: comment.endColumn || comment.column || 0,
                            severity: comment.level === 'error' ? 'error' : comment.level === 'warning' ? 'warning' : 'info',
                            message: comment.message || '',
                            rule: comment.code || 'unknown',
                            linter: 'shellcheck'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run YAML linter (yamllint)
     */
    async runYAMLLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('yamllint', ['--format', 'parsable', ...files], { timeout: 30000, allowNonZero: true });
            const lines = (result.stdout || result.stderr || '').split('\n');
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(\d+):\s*\[(error|warning)\]\s*(.*)$/);
                if (match) {
                    const [, file, lineNum, col, severity, message] = match;
                    lints.push({
                        file: path.resolve(file),
                        line: parseInt(lineNum) || 0,
                        column: parseInt(col) || 0,
                        endLine: parseInt(lineNum) || 0,
                        endColumn: parseInt(col) || 0,
                        severity: severity === 'error' ? 'error' : 'warning',
                        message: message.trim(),
                        rule: 'yamllint',
                        linter: 'yamllint'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Markdown linter (markdownlint)
     */
    async runMarkdownLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('markdownlint', ['--json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const markdownResults = JSON.parse(output);
                for (const [filePath, fileData] of Object.entries(markdownResults)) {
                    for (const issue of fileData || []) {
                        lints.push({
                            file: path.resolve(filePath),
                            line: issue.lineNumber || 0,
                            column: issue.columnNumber || 0,
                            endLine: issue.lineNumber || 0,
                            endColumn: issue.columnNumber || 0,
                            severity: issue.severity === 2 ? 'error' : 'warning',
                            message: issue.ruleNames ? issue.ruleNames.join('/') + ': ' + issue.ruleDescription : issue.ruleDescription || '',
                            rule: issue.ruleNames ? issue.ruleNames[0] : 'unknown',
                            linter: 'markdownlint'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run CSS linter (stylelint)
     */
    async runCSSLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('stylelint', ['--formatter', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const stylelintResults = JSON.parse(output);
                for (const fileResult of stylelintResults) {
                    for (const warning of fileResult.warnings || []) {
                        lints.push({
                            file: fileResult.source || '',
                            line: warning.line || 0,
                            column: warning.column || 0,
                            endLine: warning.endLine || warning.line || 0,
                            endColumn: warning.endColumn || warning.column || 0,
                            severity: warning.severity === 'error' ? 'error' : 'warning',
                            message: warning.text || '',
                            rule: warning.rule || 'unknown',
                            linter: 'stylelint'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run HTML linter (htmlhint)
     */
    async runHTMLLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('htmlhint', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const htmlhintResults = JSON.parse(output);
                for (const fileResult of htmlhintResults) {
                    for (const message of fileResult.messages || []) {
                        lints.push({
                            file: fileResult.file || '',
                            line: message.line || 0,
                            column: message.col || 0,
                            endLine: message.line || 0,
                            endColumn: message.col || 0,
                            severity: message.type === 'error' ? 'error' : 'warning',
                            message: message.message || '',
                            rule: message.rule || message.ruleId || 'unknown',
                            linter: 'htmlhint'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run SQL linter (sqlfluff)
     */
    async runSQLLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('sqlfluff', ['lint', '--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const sqlfluffResults = JSON.parse(output);
                for (const [filePath, fileData] of Object.entries(sqlfluffResults)) {
                    for (const violation of fileData.violations || []) {
                        lints.push({
                            file: path.resolve(filePath),
                            line: violation.line_no || 0,
                            column: violation.line_pos || 0,
                            endLine: violation.line_no || 0,
                            endColumn: violation.line_pos || 0,
                            severity: violation.severity === 'error' ? 'error' : 'warning',
                            message: violation.description || violation.code || '',
                            rule: violation.code || 'unknown',
                            linter: 'sqlfluff'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Lua linter (luacheck)
     */
    async runLuaLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('luacheck', ['--formatter', 'plain', ...files], { timeout: 30000, allowNonZero: true });
            const lines = (result.stdout || result.stderr || '').split('\n');
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(\d+):\s*\(([EW])\d+\)\s*(.*)$/);
                if (match) {
                    const [, file, lineNum, col, severity, message] = match;
                    lints.push({
                        file: path.resolve(file),
                        line: parseInt(lineNum) || 0,
                        column: parseInt(col) || 0,
                        endLine: parseInt(lineNum) || 0,
                        endColumn: parseInt(col) || 0,
                        severity: severity === 'E' ? 'error' : 'warning',
                        message: message.trim(),
                        rule: 'luacheck',
                        linter: 'luacheck'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Java linter (checkstyle)
     */
    async runJavaLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('checkstyle', ['-f', 'xml', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '';
                // Parse XML output (simplified)
                const fileMatches = output.matchAll(/<file name="([^"]+)">([\s\S]*?)<\/file>/g);
                for (const match of fileMatches) {
                    const filePath = match[1];
                    const content = match[2];
                    const errorMatches = content.matchAll(/<error line="(\d+)" column="(\d+)" severity="([^"]+)" message="([^"]+)" source="([^"]+)"/g);
                    for (const errMatch of errorMatches) {
                        lints.push({
                            file: path.resolve(filePath),
                            line: parseInt(errMatch[1]) || 0,
                            column: parseInt(errMatch[2]) || 0,
                            endLine: parseInt(errMatch[1]) || 0,
                            endColumn: parseInt(errMatch[2]) || 0,
                            severity: errMatch[3] === 'error' ? 'error' : 'warning',
                            message: errMatch[4] || '',
                            rule: errMatch[5] || 'unknown',
                            linter: 'checkstyle'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run C/C++ linter (cppcheck)
     */
    async runCppLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('cppcheck', ['--xml', '--xml-version=2', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '';
                // Parse XML output (simplified)
                const errorMatches = output.matchAll(/<error file="([^"]+)" line="(\d+)" column="(\d+)" severity="([^"]+)" message="([^"]+)" id="([^"]+)"/g);
                for (const match of errorMatches) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: match[4] === 'error' ? 'error' : match[4] === 'warning' ? 'warning' : 'info',
                        message: match[5] || '',
                        rule: match[6] || 'unknown',
                        linter: 'cppcheck'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run PHP linter (phpcs)
     */
    async runPHPLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('phpcs', ['--report=json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const phpcsResults = JSON.parse(output);
                for (const [filePath, fileData] of Object.entries(phpcsResults.files || {})) {
                    for (const message of fileData.messages || []) {
                        lints.push({
                            file: path.resolve(filePath),
                            line: message.line || 0,
                            column: message.column || 0,
                            endLine: message.line || 0,
                            endColumn: message.column || 0,
                            severity: message.type === 'ERROR' ? 'error' : 'warning',
                            message: message.message || '',
                            rule: message.source || 'unknown',
                            linter: 'phpcs'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Swift linter (swiftlint)
     */
    async runSwiftLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('swiftlint', ['lint', '--reporter', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const swiftlintResults = JSON.parse(output);
                for (const violation of swiftlintResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.character || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.character || 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.reason || '',
                        rule: violation.rule_id || 'unknown',
                        linter: 'swiftlint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Kotlin linter (ktlint)
     */
    async runKotlinLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('ktlint', ['--reporter=json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const ktlintResults = JSON.parse(output);
                for (const violation of ktlintResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.col || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.col || 0,
                        severity: 'error',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'ktlint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Dart linter (dart analyze)
     */
    async runDartLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('dart', ['analyze', '--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const dartResults = JSON.parse(output);
                for (const issue of dartResults.issues || []) {
                    lints.push({
                        file: issue.location.file || '',
                        line: issue.location.startLine || 0,
                        column: issue.location.startColumn || 0,
                        endLine: issue.location.endLine || issue.location.startLine || 0,
                        endColumn: issue.location.endColumn || issue.location.startColumn || 0,
                        severity: issue.severity === 'ERROR' ? 'error' : issue.severity === 'WARNING' ? 'warning' : 'info',
                        message: issue.message || '',
                        rule: issue.code || 'unknown',
                        linter: 'dart'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run JSON linter (jsonlint or JSON.parse)
     */
    async runJSONLinter(files) {
        const lints = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(file, 'utf8');
                JSON.parse(content);
            } catch (error) {
                // Try to extract line number from error
                const match = error.message.match(/position (\d+)/);
                const position = match ? parseInt(match[1]) : 0;
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                let line = 1;
                let col = 1;
                let charCount = 0;
                for (let i = 0; i < lines.length; i++) {
                    if (charCount + lines[i].length >= position) {
                        line = i + 1;
                        col = position - charCount + 1;
                        break;
                    }
                    charCount += lines[i].length + 1; // +1 for newline
                }
                lints.push({
                    file: file,
                    line: line,
                    column: col,
                    endLine: line,
                    endColumn: col,
                    severity: 'error',
                    message: error.message || 'Invalid JSON',
                    rule: 'json-parse',
                    linter: 'json'
                });
            }
        }
        return lints;
    }
    
    /**
     * Run XML linter (xmllint)
     */
    async runXMLLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('xmllint', ['--noout', file], { timeout: 30000, allowNonZero: true });
                const output = result.stderr || '';
                const match = output.match(/^([^:]+):(\d+):\s*(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: 0,
                        severity: 'error',
                        message: match[3] || '',
                        rule: 'xmllint',
                        linter: 'xmllint'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run TOML linter (taplo or basic validation)
     */
    async runTOMLLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('taplo', ['lint', '--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const taploResults = JSON.parse(output);
                for (const violation of taploResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.code || 'unknown',
                        linter: 'taplo'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Dockerfile linter (hadolint)
     */
    async runDockerfileLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('hadolint', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const hadolintResults = JSON.parse(output);
                for (const violation of hadolintResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: violation.level === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.code || 'unknown',
                        linter: 'hadolint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Terraform linter (tflint)
     */
    async runTerraformLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('tflint', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const tflintResults = JSON.parse(output);
                for (const issue of tflintResults.issues || []) {
                    lints.push({
                        file: issue.range.filename || '',
                        line: issue.range.start.line || 0,
                        column: issue.range.start.column || 0,
                        endLine: issue.range.end.line || issue.range.start.line || 0,
                        endColumn: issue.range.end.column || issue.range.start.column || 0,
                        severity: issue.severity === 'error' ? 'error' : 'warning',
                        message: issue.message || '',
                        rule: issue.rule || issue.rule_name || 'unknown',
                        linter: 'tflint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run PowerShell linter (PSScriptAnalyzer)
     */
    async runPowerShellLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('pwsh', ['-Command', `Invoke-ScriptAnalyzer -Path ${files.map(f => `'${f}'`).join(',')} -Recurse | ConvertTo-Json`], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const psResults = JSON.parse(output);
                for (const violation of Array.isArray(psResults) ? psResults : [psResults]) {
                    lints.push({
                        file: violation.ScriptPath || '',
                        line: violation.Line || 0,
                        column: violation.Column || 0,
                        endLine: violation.Line || 0,
                        endColumn: violation.Column || 0,
                        severity: violation.Severity === 'Error' ? 'error' : 'Warning' ? 'warning' : 'info',
                        message: violation.Message || '',
                        rule: violation.RuleName || 'unknown',
                        linter: 'PSScriptAnalyzer'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run R linter (lintr)
     */
    async runRLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('Rscript', ['-e', `lintr::lint_dir('.')`], { timeout: 30000, allowNonZero: true });
            const output = result.stdout || result.stderr || '';
            // Parse R lintr output (format: file:line:column: message)
            const lines = output.split('\n');
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(\d+):\s*(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: 'warning',
                        message: match[4] || '',
                        rule: 'lintr',
                        linter: 'lintr'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Perl linter (perlcritic)
     */
    async runPerlLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('perlcritic', ['--format', '%f:%l:%c:%s:%m', ...files], { timeout: 30000, allowNonZero: true });
            const lines = (result.stdout || result.stderr || '').split('\n');
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):(\d+):([^:]+):(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: match[4] === '5' ? 'error' : 'warning',
                        message: match[5] || '',
                        rule: 'perlcritic',
                        linter: 'perlcritic'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Scala linter (scalastyle)
     */
    async runScalaLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('scalastyle', ['--xmlOutput', 'true', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '';
                const errorMatches = output.matchAll(/<file name="([^"]+)">[\s\S]*?<error line="(\d+)" column="(\d+)" message="([^"]+)" source="([^"]+)"/g);
                for (const match of errorMatches) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: 'warning',
                        message: match[4] || '',
                        rule: match[5] || 'unknown',
                        linter: 'scalastyle'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Clojure linter (clj-kondo)
     */
    async runClojureLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('clj-kondo', ['--lint', '--config', '{:output {:format :json}}', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const cljResults = JSON.parse(output);
                for (const finding of cljResults.findings || []) {
                    lints.push({
                        file: finding.filename || '',
                        line: finding.row || 0,
                        column: finding.col || 0,
                        endLine: finding.endRow || finding.row || 0,
                        endColumn: finding.endCol || finding.col || 0,
                        severity: finding.level === 'error' ? 'error' : finding.level === 'warning' ? 'warning' : 'info',
                        message: finding.message || '',
                        rule: finding.type || 'unknown',
                        linter: 'clj-kondo'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Haskell linter (hlint)
     */
    async runHaskellLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('hlint', ['--json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const hlintResults = JSON.parse(output);
                for (const hint of hlintResults) {
                    lints.push({
                        file: hint.file || '',
                        line: hint.startLine || 0,
                        column: hint.startColumn || 0,
                        endLine: hint.endLine || hint.startLine || 0,
                        endColumn: hint.endColumn || hint.startColumn || 0,
                        severity: 'warning',
                        message: hint.hint || '',
                        rule: 'hlint',
                        linter: 'hlint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Erlang linter (elvis)
     */
    async runErlangLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('elvis', ['rock', '--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const elvisResults = JSON.parse(output);
                for (const violation of elvisResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line_num || 0,
                        column: 0,
                        endLine: violation.line_num || 0,
                        endColumn: 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'elvis'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Elixir linter (credo)
     */
    async runElixirLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('mix', ['credo', '--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const credoResults = JSON.parse(output);
                for (const issue of credoResults.issues || []) {
                    lints.push({
                        file: issue.filename || '',
                        line: issue.line_no || 0,
                        column: issue.column || 0,
                        endLine: issue.line_no || 0,
                        endColumn: issue.column || 0,
                        severity: issue.category === 'error' ? 'error' : 'warning',
                        message: issue.message || '',
                        rule: issue.check || 'unknown',
                        linter: 'credo'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run OCaml linter (ocaml-lint)
     */
    async runOCamlLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('ocaml-lint', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const ocamlResults = JSON.parse(output);
                for (const violation of ocamlResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'ocaml-lint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run F# linter (dotnet format)
     */
    async runFSharpLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('dotnet', ['format', '--verify-no-changes', '--verbosity', 'diagnostic', ...files], { timeout: 30000, allowNonZero: true });
            const lines = (result.stdout || result.stderr || '').split('\n');
            for (const line of lines) {
                const match = line.match(/^([^\(]+)\((\d+),(\d+)\):\s*(error|warning)\s*([^:]+):\s*(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: match[4] === 'error' ? 'error' : 'warning',
                        message: match[6] || '',
                        rule: match[5] || 'unknown',
                        linter: 'dotnet'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run C# linter (dotnet format or StyleCop)
     */
    async runCSharpLinter(files) {
        return await this.runFSharpLinter(files); // Same tool
    }
    
    /**
     * Run Groovy linter (CodeNarc)
     */
    async runGroovyLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('codenarc', ['-basedir', '.', '-report', 'json'], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const codenarcResults = JSON.parse(output);
                for (const fileData of codenarcResults.files || []) {
                    for (const violation of fileData.violations || []) {
                        lints.push({
                            file: fileData.path || '',
                            line: violation.lineNumber || 0,
                            column: 0,
                            endLine: violation.lineNumber || 0,
                            endColumn: 0,
                            severity: violation.priority === 1 ? 'error' : 'warning',
                            message: violation.message || '',
                            rule: violation.ruleName || 'unknown',
                            linter: 'codenarc'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Objective-C linter (OCLint)
     */
    async runObjectiveCLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('oclint', ['--report-type', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const oclintResults = JSON.parse(output);
                for (const violation of oclintResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'oclint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run D linter (dscanner)
     */
    async runDLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('dscanner', ['--report', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const dscannerResults = JSON.parse(output);
                for (const violation of dscannerResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'dscanner'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Nim linter (nim check)
     */
    async runNimLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('nim', ['check', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stdout || result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+)\((\d+),(\d+)\)\s*(Error|Warning):\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: parseInt(match[3]) || 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: parseInt(match[3]) || 0,
                            severity: match[4] === 'Error' ? 'error' : 'warning',
                            message: match[5] || '',
                            rule: 'nim-check',
                            linter: 'nim'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Crystal linter (ameba)
     */
    async runCrystalLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('ameba', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '{}';
                const amebaResults = JSON.parse(output);
                for (const source of amebaResults.sources || []) {
                    for (const issue of source.issues || []) {
                        lints.push({
                            file: source.filename || '',
                            line: issue.line || 0,
                            column: issue.column || 0,
                            endLine: issue.line || 0,
                            endColumn: issue.column || 0,
                            severity: issue.severity === 'error' ? 'error' : 'warning',
                            message: issue.message || '',
                            rule: issue.rule || 'unknown',
                            linter: 'ameba'
                        });
                    }
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Zig linter (zig build-exe or zig fmt --check)
     */
    async runZigLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('zig', ['fmt', '--check', file], { timeout: 30000, allowNonZero: true });
                const output = result.stderr || '';
                const match = output.match(/^([^:]+):(\d+):(\d+):\s*(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: parseInt(match[3]) || 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: parseInt(match[3]) || 0,
                        severity: 'error',
                        message: match[4] || '',
                        rule: 'zig-fmt',
                        linter: 'zig'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Julia linter (Lint.jl)
     */
    async runJuliaLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('julia', ['-e', `using Lint; lintfile("${files[0]}")`], { timeout: 30000, allowNonZero: true });
            const lines = (result.stdout || result.stderr || '').split('\n');
            for (const line of lines) {
                const match = line.match(/^([^:]+):(\d+):\s*(.*)$/);
                if (match) {
                    lints.push({
                        file: path.resolve(match[1]),
                        line: parseInt(match[2]) || 0,
                        column: 0,
                        endLine: parseInt(match[2]) || 0,
                        endColumn: 0,
                        severity: 'warning',
                        message: match[3] || '',
                        rule: 'julia-lint',
                        linter: 'julia'
                    });
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Fortran linter (gfortran or flint)
     */
    async runFortranLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('gfortran', ['-fsyntax-only', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+):(\d+):(\d+):\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: parseInt(match[3]) || 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: parseInt(match[3]) || 0,
                            severity: 'error',
                            message: match[4] || '',
                            rule: 'gfortran',
                            linter: 'gfortran'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run COBOL linter (cobc)
     */
    async runCOBOLLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('cobc', ['-fsyntax-only', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+):(\d+):\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: 0,
                            severity: 'error',
                            message: match[3] || '',
                            rule: 'cobc',
                            linter: 'cobc'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Ada linter (gnat)
     */
    async runAdaLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('gnat', ['-gnatc', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+):(\d+):(\d+):\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: parseInt(match[3]) || 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: parseInt(match[3]) || 0,
                            severity: 'error',
                            message: match[4] || '',
                            rule: 'gnat',
                            linter: 'gnat'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run VHDL linter (ghdl)
     */
    async runVHDLLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('ghdl', ['-s', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^([^:]+):(\d+)(?::(\d+))?:\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: match[3] ? parseInt(match[3]) : 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: match[3] ? parseInt(match[3]) : 0,
                            severity: 'error',
                            message: match[4] || '',
                            rule: 'ghdl',
                            linter: 'ghdl'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Verilog linter (verilator)
     */
    async runVerilogLinter(files) {
        const lints = [];
        try {
            for (const file of files) {
                const result = await this.runCommand('verilator', ['--lint-only', file], { timeout: 30000, allowNonZero: true });
                const lines = (result.stderr || '').split('\n');
                for (const line of lines) {
                    const match = line.match(/^%([^:]+):(\d+):\s*(.*)$/);
                    if (match) {
                        lints.push({
                            file: path.resolve(match[1]),
                            line: parseInt(match[2]) || 0,
                            column: 0,
                            endLine: parseInt(match[2]) || 0,
                            endColumn: 0,
                            severity: 'error',
                            message: match[3] || '',
                            rule: 'verilator',
                            linter: 'verilator'
                        });
                    }
                }
            }
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run Makefile linter (checkmake)
     */
    async runMakefileLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('checkmake', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const checkmakeResults = JSON.parse(output);
                for (const violation of checkmakeResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: 0,
                        endLine: violation.line || 0,
                        endColumn: 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'checkmake'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Run CMake linter (cmake-lint)
     */
    async runCMakeLinter(files) {
        const lints = [];
        try {
            const result = await this.runCommand('cmake-lint', ['--format', 'json', ...files], { timeout: 30000, allowNonZero: true });
            try {
                const output = result.stdout || result.stderr || '[]';
                const cmakeResults = JSON.parse(output);
                for (const violation of cmakeResults) {
                    lints.push({
                        file: violation.file || '',
                        line: violation.line || 0,
                        column: violation.column || 0,
                        endLine: violation.line || 0,
                        endColumn: violation.column || 0,
                        severity: violation.severity === 'error' ? 'error' : 'warning',
                        message: violation.message || '',
                        rule: violation.rule || 'unknown',
                        linter: 'cmake-lint'
                    });
                }
            } catch (e) {}
        } catch (error) {}
        return lints;
    }
    
    /**
     * Find nearest file with given name
     */
    findNearestFile(filename, startPath) {
        let currentDir = path.dirname(path.resolve(startPath));
        const root = path.parse(currentDir).root;
        
        while (currentDir !== root) {
            const filePath = path.join(currentDir, filename);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
            currentDir = path.dirname(currentDir);
        }
        
        return null;
    }
    
    /**
     * Run a command and return stdout/stderr
     */
    runCommand(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const { timeout = 10000, cwd = process.cwd(), allowNonZero = false } = options;
            
            const child = spawn(command, args, {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            const timer = timeout > 0 ? setTimeout(() => {
                child.kill();
                reject(new Error(`Command timeout after ${timeout}ms`));
            }, timeout) : null;
            
            child.on('close', (code) => {
                if (timer) clearTimeout(timer);
                
                // For linters, non-zero exit codes often mean linting errors found, which is expected
                if (code !== 0 && !allowNonZero) {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`));
                    return;
                }
                
                resolve({ exitCode: code, stdout, stderr });
            });
            
            child.on('error', (error) => {
                if (timer) clearTimeout(timer);
                reject(error);
            });
        });
    }

    /**
     * Execute web_search tool
     * Default: Brave Search (if .brave-api-key exists) > DuckDuckGo (free, no key)
     */
    async executeWebSearch(args) {
        const toolName = 'web_search';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { search_term, count = 10, summaryUrlCount = 5, summaryMaxTokens = 5000, summaryLengthTokens = 1000, maxContentLength = 4000 } = args;
            
            if (!search_term || search_term.trim() === '') {
                throw new Error('search_term is required');
            }
            
            // Validate count
            const maxCount = Math.max(1, Math.min(count || 10, 1000)); // Clamp between 1 and 1000
            
            let searchResult;
            
            // Try Brave Search first (default, free tier: 2,000 queries/month, requires API key)
            const braveKeyPath = path.join(__dirname, '.brave-api-key');
            const hasBraveKey = fs.existsSync(braveKeyPath);
            
            if (hasBraveKey) {
                try {
                    searchResult = await this.executeBraveSearch(search_term, maxCount);
                } catch (error) {
                    console.warn('Brave search failed, trying DuckDuckGo:', error.message);
                    
                    // Fallback to DuckDuckGo (completely free, no API key required)
                    try {
                        searchResult = await this.executeDuckDuckGoSearch(search_term, maxCount);
                    } catch (error) {
                        throw new Error(`Both Brave and DuckDuckGo search failed. Last error: ${error.message}`);
                    }
                }
            } else {
                // No Brave key, use DuckDuckGo
                try {
                    searchResult = await this.executeDuckDuckGoSearch(search_term, maxCount);
                } catch (error) {
                    throw new Error(`DuckDuckGo search failed: ${error.message}`);
                }
            }
            
            // Fetch and summarize URLs (configurable count, default 5)
            if (searchResult && searchResult.results && searchResult.results.length > 0) {
                const urlCount = Math.max(1, Math.min(summaryUrlCount || 5, searchResult.results.length));
                const urlsToFetch = searchResult.results.slice(0, urlCount);
                
                if (urlsToFetch.length > 0) {
                    const summaries = await this.fetchAndSummarizeUrls(urlsToFetch, {
                        summaryMaxTokens: summaryMaxTokens || 5000,
                        summaryLengthTokens: summaryLengthTokens || 1000,
                        maxContentLength: maxContentLength || 4000
                    });
                    
                    // Replace snippets with summaries
                    for (let i = 0; i < Math.min(summaries.length, urlsToFetch.length); i++) {
                        if (searchResult.results[i] && summaries[i]) {
                            // Replace snippet with summary
                            searchResult.results[i].snippet = summaries[i];
                            searchResult.results[i].summary = summaries[i];
                        }
                    }
                }
            }
            
            this.emit('tool:complete', { toolName, args, result: searchResult });
            return searchResult;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }
    
    /**
     * Execute search using Brave Search API (free tier: 2,000 queries/month, requires API key)
     */
    async executeBraveSearch(searchTerm, maxCount = 100) {
        const toolName = 'web_search';
        
        // Read Brave API key from file
        const braveKeyPath = path.join(__dirname, '.brave-api-key');
        const apiKey = readAPIKey(braveKeyPath);
        
        // Brave Search API max is 20 per request, so we may need multiple requests
        const braveMaxPerRequest = 20;
        const results = [];
        let offset = 0;
        const targetCount = Math.min(maxCount, 100); // Cap at 100 for practical purposes
        
        while (results.length < targetCount) {
            const requestCount = Math.min(braveMaxPerRequest, targetCount - results.length);
            
            // Brave Search API endpoint
            const endpoint = 'https://api.search.brave.com/res/v1/web/search';
            const params = new URLSearchParams({
                q: searchTerm,
                count: String(requestCount),
                offset: String(offset),
                safesearch: 'moderate',
                freshness: 'pd' // Past day (optional: can be 'pd', 'pw', 'pm', 'py' or omitted)
            });
            
            const url = `${endpoint}?${params.toString()}`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip',
                    'X-Subscription-Token': apiKey,
                    'User-Agent': 'b__d-llm-client/1.0'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Brave Search API error (${response.status}): ${errorText}`);
            }
            
            const data = await response.json();
            
            // Format results to match expected structure
            if (data.web && data.web.results) {
                for (const item of data.web.results) {
                    if (results.length >= targetCount) break;
                    results.push({
                        title: item.title || '',
                        snippet: item.description || '',
                        url: item.url || '',
                        displayUrl: item.url ? new URL(item.url).hostname : ''
                    });
                }
            }
            
            // If we got fewer results than requested, we've reached the end
            if (!data.web || !data.web.results || data.web.results.length < requestCount) {
                break;
            }
            
            offset += requestCount;
        }
        
        const result = {
            results: results.slice(0, targetCount),
            totalResults: results.length,
            source: 'Brave'
        };
        
        this.emit('tool:complete', { toolName, args: { search_term: searchTerm }, result });
        return result;
    }
    
    /**
     * Execute search using DuckDuckGo (free, no API key required)
     * Uses DuckDuckGo Instant Answer API and HTML search as fallback
     */
    async executeDuckDuckGoSearch(searchTerm, maxCount = 100) {
        const toolName = 'web_search';
        const results = [];
        const targetCount = Math.min(maxCount, 100); // Cap at 100 for practical purposes
        
        try {
            // Try DuckDuckGo Instant Answer API first (JSON, more reliable)
            const instantEndpoint = 'https://api.duckduckgo.com/';
            const instantParams = new URLSearchParams({
                q: searchTerm,
                format: 'json',
                no_html: '1',
                skip_disambig: '1'
            });
            
            const instantUrl = `${instantEndpoint}?${instantParams.toString()}`;
            const instantResponse = await fetch(instantUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'b__d-llm-client/1.0'
                }
            });
            
            if (instantResponse.ok) {
                const instantData = await instantResponse.json();
                
                // Add abstract/answer if available
                if (instantData.AbstractText && results.length < targetCount) {
                    results.push({
                        title: instantData.Heading || searchTerm,
                        snippet: instantData.AbstractText,
                        url: instantData.AbstractURL || '',
                        displayUrl: instantData.AbstractURL ? new URL(instantData.AbstractURL).hostname : ''
                    });
                }
                
                // Add related topics
                if (instantData.RelatedTopics && Array.isArray(instantData.RelatedTopics)) {
                    for (const topic of instantData.RelatedTopics) {
                        if (results.length >= targetCount) break;
                        if (topic.Text && topic.FirstURL) {
                            results.push({
                                title: topic.Text.split(' - ')[0] || topic.Text,
                                snippet: topic.Text.includes(' - ') ? topic.Text.split(' - ')[1] : topic.Text,
                                url: topic.FirstURL,
                                displayUrl: new URL(topic.FirstURL).hostname
                            });
                        }
                    }
                }
            }
        } catch (error) {
            // Continue to HTML fallback if instant API fails
        }
        
        // Use HTML search to get more results if needed
        if (results.length < targetCount) {
            try {
                const htmlEndpoint = 'https://html.duckduckgo.com/html/';
                const htmlParams = new URLSearchParams({
                    q: searchTerm
                });
                
                const htmlUrl = `${htmlEndpoint}?${htmlParams.toString()}`;
                const htmlResponse = await fetch(htmlUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (htmlResponse.ok) {
                    const html = await htmlResponse.text();
                    
                    // Parse HTML results (more robust regex patterns)
                    const titlePattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
                    const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)<\/a>/gi;
                    
                    const titles = [];
                    const snippets = [];
                    let match;
                    
                    // Extract titles and URLs (get more than we need to account for duplicates)
                    const extractLimit = Math.min(targetCount * 2, 200);
                    while ((match = titlePattern.exec(html)) !== null && titles.length < extractLimit) {
                        if (match[1] && match[2]) {
                            titles.push({
                                url: match[1],
                                title: match[2].trim().replace(/\s+/g, ' ')
                            });
                        }
                    }
                    
                    // Extract snippets
                    while ((match = snippetPattern.exec(html)) !== null && snippets.length < extractLimit) {
                        if (match[1]) {
                            snippets.push(match[1].trim().replace(/\s+/g, ' '));
                        }
                    }
                    
                    // Combine titles and snippets, avoiding duplicates
                    const seenUrls = new Set(results.map(r => r.url));
                    for (let i = 0; i < titles.length && results.length < targetCount; i++) {
                        if (!seenUrls.has(titles[i].url)) {
                            try {
                                results.push({
                                    title: titles[i].title,
                                    snippet: snippets[i] || '',
                                    url: titles[i].url,
                                    displayUrl: new URL(titles[i].url).hostname
                                });
                                seenUrls.add(titles[i].url);
                            } catch (e) {
                                // Skip invalid URLs
                            }
                        }
                    }
                }
            } catch (error) {
                // If HTML parsing also fails, continue with what we have
            }
        }
        
        const result = {
            results: results.slice(0, targetCount),
            totalResults: results.length,
            source: 'DuckDuckGo'
        };
        
        this.emit('tool:complete', { toolName, args: { search_term: searchTerm }, result });
        return result;
    }
    
    /**
     * Fetch and summarize content from URLs
     * Fetches all URLs concurrently, then uses ONE LLM call to summarize all of them
     * @param {Array} urlResults - Array of URL result objects
     * @param {Object} options - Options for summarization
     * @param {number} options.summaryMaxTokens - Maximum tokens for the entire summary response (default: 5000)
     * @param {number} options.summaryLengthTokens - Approximate tokens per individual summary (default: 1000)
     * @param {number} options.maxContentLength - Maximum content length per URL in words (default: 4000)
     */
    async fetchAndSummarizeUrls(urlResults, options = {}) {
        const { summaryMaxTokens = 5000, summaryLengthTokens = 1000, maxContentLength = 4000 } = options;
        // Fetch all URLs concurrently
        const fetchPromises = urlResults.map(async (result, index) => {
            try {
                const url = result.url;
                const title = result.title || url;
                
                if (!url || !url.startsWith('http')) {
                    return { index, url, title, textContent: null, error: 'Invalid URL' };
                }
                
                // Fetch the URL with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                        },
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!response.ok) {
                        return { index, url, title, textContent: null, error: `HTTP ${response.status}` };
                    }
                    
                    const html = await response.text();
                    const textContent = this.extractTextFromHTML(html);
                    
                    return { index, url, title, textContent, error: null };
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    if (fetchError.name === 'AbortError') {
                        return { index, url, title, textContent: null, error: 'Request timeout' };
                    }
                    return { index, url, title, textContent: null, error: fetchError.message };
                }
            } catch (error) {
                return { index, url: result.url, title: result.title || result.url, textContent: null, error: error.message };
            }
        });
        
        // Wait for all fetches to complete
        const fetchResults = await Promise.all(fetchPromises);
        
        // Sort by index to maintain order
        fetchResults.sort((a, b) => a.index - b.index);
        
        // Use ONE LLM call to summarize all URLs together
        try {
            const summaries = await this.summarizeMultipleWithLLM(fetchResults, options);
            return summaries;
        } catch (error) {
            console.warn('LLM summarization failed, using fallback:', error.message);
            // Fallback to simple truncation
            return fetchResults.map(result => {
                if (result.error) {
                    return `Failed to fetch: ${result.error}`;
                } else if (result.textContent) {
                    return this.summarizeTextFallback(result.textContent);
                } else {
                    return 'No content available';
                }
            });
        }
    }
    
    /**
     * Summarize multiple URLs' content using ONE LLM call
     * @param {Array} fetchResults - Array of fetch result objects
     * @param {Object} options - Options for summarization
     * @param {number} options.summaryMaxTokens - Maximum tokens for the entire summary response (default: 5000)
     * @param {number} options.summaryLengthTokens - Approximate tokens per individual summary (default: 1000)
     * @param {number} options.maxContentLength - Maximum content length per URL in words (default: 4000)
     */
    async summarizeMultipleWithLLM(fetchResults, options = {}) {
        const { summaryMaxTokens = 5000, summaryLengthTokens = 1000, maxContentLength = 4000 } = options;
        
        console.log(`[DEBUG] summarizeMultipleWithLLM: Processing ${fetchResults.length} URLs`);
        
        // Build JSON structure with all URLs and their content
        const urlData = [];
        for (let i = 0; i < fetchResults.length; i++) {
            const result = fetchResults[i];
            if (result.error) {
                console.log(`[DEBUG] URL ${i + 1} (${result.url}): Error - ${result.error}`);
                urlData.push({
                    url: result.url,
                    title: result.title,
                    error: result.error
                });
            } else if (result.textContent) {
                console.log(`[DEBUG] URL ${i + 1} (${result.url}): Fetched ${result.textContent.length} chars`);
                // Truncate each URL's content based on maxContentLength (in words)
                // Approximate: 1 word ≈ 5 characters (including space), so maxContentLength * 5 chars
                const maxCharsPerUrl = maxContentLength * 5;
                const truncated = result.textContent.length > maxCharsPerUrl 
                    ? result.textContent.substring(0, maxCharsPerUrl) + '...'
                    : result.textContent;
                urlData.push({
                    url: result.url,
                    title: result.title,
                    content: truncated
                });
            } else {
                console.log(`[DEBUG] URL ${i + 1} (${result.url}): No content`);
                urlData.push({
                    url: result.url,
                    title: result.title,
                    content: null
                });
            }
        }
        
        // Calculate approximate words per summary (1 token ≈ 0.75 words, so summaryLengthTokens * 0.75)
        const approximateWords = Math.floor(summaryLengthTokens * 0.75);
        
        // Create JSON request
        const requestJson = {
            urls: urlData,
            instructions: {
                summaryLengthWords: approximateWords,
                format: "json",
                summaryStyle: "detailed"
            }
        };
        
        const summaryPrompt = `You are a web content summarizer. Please provide detailed summaries for the following web pages.

Input (JSON format):
${JSON.stringify(requestJson, null, 2)}

Requirements:
- Each summary should be approximately ${approximateWords} words in length (aim for 8-12 sentences to reach this word count)
- Summaries should be detailed and comprehensive, covering main points, key information, and important details
- Do not truncate or abbreviate - provide full, complete summaries that meet or exceed the target word count
- Provide summaries in JSON format with this structure:
{
  "summaries": [
    {
      "url": "url1",
      "summary": "detailed summary text here..."
    },
    {
      "url": "url2",
      "summary": "detailed summary text here..."
    }
  ]
}

Please provide your response as valid JSON only.`;

        // Don't use system prompt for summarization - just use user message
        const messages = [
            {
                role: 'user',
                content: summaryPrompt
            }
        ];
        
        console.log(`[DEBUG] Calling LLM with ${fetchResults.length} URLs to summarize...`);
        
        // Use the same model as configured for the client
        let response;
        try {
            // Use configured max tokens for reasoning models and multiple summaries
            // Skip tools and system prompt for summary generation
            response = await this.callLLM(this.model, messages, {
                max_tokens: summaryMaxTokens,
                temperature: 0.3,
                skipTools: true
            });
            console.log(`[DEBUG] LLM call successful`);
        } catch (error) {
            console.error(`[DEBUG] LLM call failed:`, error.message);
            throw error;
        }
        
        if (response.choices && response.choices[0] && response.choices[0].message) {
            const responseText = response.choices[0].message.content;
            if (!responseText) {
                console.error(`[DEBUG] LLM returned empty content`);
                console.error(`[DEBUG] Full response:`, JSON.stringify(response, null, 2));
                throw new Error('LLM returned empty content');
            }
            
            const trimmed = responseText.trim();
            console.log(`[DEBUG] LLM response length: ${trimmed.length} chars`);
            console.log(`[DEBUG] LLM response preview: ${trimmed.substring(0, 500)}...`);
            
            // Parse the summaries from JSON response
            const summaries = this.parseSummariesFromJSONResponse(responseText, fetchResults);
            console.log(`[DEBUG] Parsed ${summaries.length} summaries`);
            summaries.forEach((s, i) => {
                console.log(`[DEBUG] Summary ${i+1} (${s.length} chars): ${s.substring(0, 100)}...`);
            });
            
            // Ensure we have the right number of summaries
            while (summaries.length < fetchResults.length) {
                summaries.push('Unable to generate summary');
            }
            
            return summaries.slice(0, fetchResults.length);
        }
        
        console.error(`[DEBUG] Unexpected response structure:`, JSON.stringify(response, null, 2));
        throw new Error('No response from LLM');
    }
    
    /**
     * Parse summaries from JSON LLM response
     */
    parseSummariesFromJSONResponse(responseText, fetchResults) {
        const summaries = [];
        
        if (!responseText || responseText.trim().length === 0) {
            console.log(`[DEBUG] Empty response text, returning fallback summaries`);
            return fetchResults.map(() => 'Unable to generate summary');
        }
        
        try {
            // Try to extract JSON from the response (may have markdown code blocks or extra text)
            let jsonText = responseText.trim();
            
            // Remove markdown code blocks if present
            const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                jsonText = jsonMatch[1];
            } else {
                // Try to find JSON object in the text
                const jsonObjMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonObjMatch) {
                    jsonText = jsonObjMatch[0];
                }
            }
            
            const parsed = JSON.parse(jsonText);
            
            if (parsed.summaries && Array.isArray(parsed.summaries)) {
                // Create a map of URL to summary
                const summaryMap = new Map();
                parsed.summaries.forEach(item => {
                    if (item.url && item.summary) {
                        summaryMap.set(item.url, item.summary);
                    }
                });
                
                // Match summaries to fetchResults by URL
                fetchResults.forEach(result => {
                    const summary = summaryMap.get(result.url);
                    if (summary && summary.trim().length > 0) {
                        summaries.push(summary.trim());
                    } else {
                        summaries.push('Unable to generate summary');
                    }
                });
                
                console.log(`[DEBUG] Successfully parsed ${summaries.length} summaries from JSON`);
                return summaries;
            } else {
                console.log(`[DEBUG] JSON response missing 'summaries' array, trying fallback parsing`);
            }
        } catch (error) {
            console.log(`[DEBUG] Failed to parse JSON response: ${error.message}, trying fallback parsing`);
        }
        
        // Fallback to old parsing method if JSON parsing fails
        return this.parseSummariesFromResponse(responseText, fetchResults.length);
    }
    
    /**
     * Parse summaries from LLM response (fallback method for non-JSON responses)
     */
    parseSummariesFromResponse(responseText, expectedCount) {
        const summaries = [];
        
        // Try to extract numbered summaries (1., 2., etc.)
        const numberedPattern = /^\s*(\d+)\.\s*(.+?)(?=\n\s*\d+\.|$)/gms;
        let match;
        const found = [];
        
        while ((match = numberedPattern.exec(responseText)) !== null) {
            const num = parseInt(match[1]);
            const summary = match[2].trim();
            found[num - 1] = summary; // Convert to 0-based index
        }
        
        // If we found numbered summaries, use them
        if (found.length > 0) {
            for (let i = 0; i < expectedCount; i++) {
                summaries.push(found[i] || 'Unable to generate summary');
            }
            return summaries;
        }
        
        // Otherwise, try splitting by double newlines or other patterns
        const lines = responseText.split(/\n\s*\n/);
        for (let i = 0; i < expectedCount && i < lines.length; i++) {
            const line = lines[i].trim();
            // Remove leading numbers if present
            const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
            summaries.push(cleaned || 'Unable to generate summary');
        }
        
        // If still not enough, pad with fallback
        while (summaries.length < expectedCount) {
            summaries.push('Unable to generate summary');
        }
        
        return summaries;
    }
    
    /**
     * Extract text content from HTML
     */
    extractTextFromHTML(html) {
        // Remove script and style tags
        let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
        
        // Remove HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        
        // Decode HTML entities (basic ones)
        text = text.replace(/&nbsp;/g, ' ');
        text = text.replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<');
        text = text.replace(/&gt;/g, '>');
        text = text.replace(/&quot;/g, '"');
        text = text.replace(/&#39;/g, "'");
        
        // Clean up whitespace
        text = text.replace(/\s+/g, ' ');
        text = text.trim();
        
        return text;
    }
    
    /**
     * Summarize text content using LLM
     */
    async summarizeWithLLM(text, url) {
        if (!text || text.length === 0) {
            return 'No content available';
        }
        
        // Truncate text to reasonable length for LLM (keep first 8000 chars to avoid token limits)
        const maxTextLength = 8000;
        const truncatedText = text.length > maxTextLength 
            ? text.substring(0, maxTextLength) + '...'
            : text;
        
        try {
            // Use the LLM to summarize
            const summaryPrompt = `Please provide a concise summary (2-3 sentences, maximum 300 words) of the following web page content. Focus on the main points and key information:

URL: ${url}

Content:
${truncatedText}

Summary:`;

            const messages = [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that creates concise summaries of web content.'
                },
                {
                    role: 'user',
                    content: summaryPrompt
                }
            ];
            
            // Use the same model as configured for the client
            const response = await this.callLLM(this.model, messages, {
                max_tokens: 300,
                temperature: 0.3
            });
            
            if (response.choices && response.choices[0] && response.choices[0].message) {
                const summary = response.choices[0].message.content.trim();
                return summary || 'Unable to generate summary';
            }
            
            return 'Unable to generate summary';
        } catch (error) {
            // Fallback to simple truncation if LLM fails
            console.warn(`LLM summarization failed for ${url}, using fallback:`, error.message);
            return this.summarizeTextFallback(text);
        }
    }
    
    /**
     * Fallback text summarization (simple truncation)
     */
    summarizeTextFallback(text, maxLength = 500) {
        if (!text || text.length === 0) {
            return 'No content available';
        }
        
        // Remove extra whitespace and newlines
        const cleaned = text.replace(/\s+/g, ' ').trim();
        
        // If text is short enough, return as-is
        if (cleaned.length <= maxLength) {
            return cleaned;
        }
        
        // Try to find a good breaking point (sentence end)
        const truncated = cleaned.substring(0, maxLength);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastExclamation = truncated.lastIndexOf('!');
        const lastQuestion = truncated.lastIndexOf('?');
        
        const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);
        
        if (lastSentenceEnd > maxLength * 0.7) {
            // Use sentence boundary if it's not too early
            return truncated.substring(0, lastSentenceEnd + 1) + '...';
        }
        
        // Otherwise, just truncate at word boundary
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    /**
     * Execute update_memory tool
     */
    async executeUpdateMemory(args) {
        const toolName = 'update_memory';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { action = 'create', title, knowledge_to_store, existing_knowledge_id } = args;
            const memoryFile = path.join(__dirname, '.memories.json');
            
            // Load existing memories
            let memories = [];
            if (fs.existsSync(memoryFile)) {
                try {
                    const content = fs.readFileSync(memoryFile, 'utf8');
                    memories = JSON.parse(content);
                } catch (e) {
                    memories = [];
                }
            }
            
            if (action === 'create') {
                if (!title || !knowledge_to_store) {
                    throw new Error('title and knowledge_to_store are required for create action');
                }
                const newMemory = {
                    id: `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    title,
                    knowledge: knowledge_to_store,
                    created: new Date().toISOString()
                };
                memories.push(newMemory);
                const result = { success: true, id: newMemory.id };
                this.emit('tool:complete', { toolName, args, result });
                fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2), 'utf8');
                return result;
            } else if (action === 'update') {
                if (!existing_knowledge_id || !title || !knowledge_to_store) {
                    throw new Error('existing_knowledge_id, title, and knowledge_to_store are required for update action');
                }
                const index = memories.findIndex(m => m.id === existing_knowledge_id);
                if (index === -1) {
                    throw new Error(`Memory with id ${existing_knowledge_id} not found`);
                }
                memories[index].title = title;
                memories[index].knowledge = knowledge_to_store;
                memories[index].updated = new Date().toISOString();
                const result = { success: true, id: existing_knowledge_id };
                this.emit('tool:complete', { toolName, args, result });
                fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2), 'utf8');
                return result;
            } else if (action === 'delete') {
                if (!existing_knowledge_id) {
                    throw new Error('existing_knowledge_id is required for delete action');
                }
                const index = memories.findIndex(m => m.id === existing_knowledge_id);
                if (index === -1) {
                    throw new Error(`Memory with id ${existing_knowledge_id} not found`);
                }
                memories.splice(index, 1);
                const result = { success: true };
                this.emit('tool:complete', { toolName, args, result });
                fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2), 'utf8');
                return result;
            } else {
                throw new Error(`Invalid action: ${action}`);
            }
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute todo_write tool
     */
    async executeTodoWrite(args) {
        const toolName = 'todo_write';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { merge = false, todos } = args;
            
            if (!todos || !Array.isArray(todos) || todos.length === 0) {
                throw new Error('todos array is required and must not be empty');
            }
            
            // Validate todos structure
            for (const todo of todos) {
                if (!todo.id || !todo.status || !todo.content) {
                    throw new Error('Each todo must have id, status, and content fields');
                }
                if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(todo.status)) {
                    throw new Error(`Invalid todo status: ${todo.status}`);
                }
            }
            
            const todoFile = path.join(__dirname, '.todos.json');
            
            // Load existing todos
            let existingTodos = [];
            if (merge && fs.existsSync(todoFile)) {
                try {
                    const content = fs.readFileSync(todoFile, 'utf8');
                    existingTodos = JSON.parse(content);
                } catch (e) {
                    existingTodos = [];
                }
            }
            
            if (merge) {
                // Merge todos by id
                const todoMap = new Map(existingTodos.map(t => [t.id, t]));
                for (const todo of todos) {
                    todoMap.set(todo.id, todo);
                }
                existingTodos = Array.from(todoMap.values());
            } else {
                // Replace all todos
                existingTodos = todos;
            }
            
            // Save todos
            fs.writeFileSync(todoFile, JSON.stringify(existingTodos, null, 2), 'utf8');
            
            const result = { success: true, count: existingTodos.length };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute edit_file tool
     */
    async executeEditFile(args) {
        const toolName = 'edit_file';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { target_file, instructions, code_edit } = args;
            const fullPath = path.isAbsolute(target_file) ? target_file : path.join(process.cwd(), target_file);
            
            if (this.mode === 'ask') {
                throw new Error('edit_file is not allowed in ask mode');
            }
            
            // If file doesn't exist, create it with the code_edit content
            if (!fs.existsSync(fullPath)) {
                fs.writeFileSync(fullPath, code_edit, 'utf8');
                const result = { success: true, action: 'created' };
                this.emit('tool:complete', { toolName, args, result });
                return result;
            }
            
            // Read existing file content
            let existingContent = fs.readFileSync(fullPath, 'utf8');
            const existingLines = existingContent.split('\n');
            
            // Check if code_edit is a unified diff format (patch format)
            const isUnifiedDiff = code_edit.trim().includes('@@') && /^@@/.test(code_edit.trim());
            
            if (isUnifiedDiff) {
                // Apply unified diff/patch format
                const patchedContent = this.applyUnifiedDiff(existingContent, code_edit);
                fs.writeFileSync(fullPath, patchedContent, 'utf8');
                const result = { success: true, action: 'patched' };
                this.emit('tool:complete', { toolName, args, result });
                return result;
            }
            
            // Check if code_edit contains the special comment pattern
            const skipCommentPatterns = [
                /^\/\/ \.\.\. existing code \.\.\./,
                /^# \.\.\. existing code \.\.\./,
                /^<!-- \.\.\. existing code \.\.\. -->/,
                /^\/\* \.\.\. existing code \.\.\. \*\//,
            ];
            
            const editLines = code_edit.split('\n');
            const hasSkipComments = editLines.some(line => 
                skipCommentPatterns.some(pattern => pattern.test(line.trim()))
            );
            
            if (!hasSkipComments) {
                // No skip comments found, replace entire file
                fs.writeFileSync(fullPath, code_edit, 'utf8');
                const result = { success: true, action: 'replaced' };
                this.emit('tool:complete', { toolName, args, result });
                return result;
            }
            
            // Process edit with skip comments
            // This is a simplified implementation - looks for context to match edits
            let resultLines = [];
            let existingIndex = 0;
            
            for (let i = 0; i < editLines.length; i++) {
                const editLine = editLines[i];
                const trimmed = editLine.trim();
                
                // Check if this is a skip comment
                const isSkipComment = skipCommentPatterns.some(pattern => pattern.test(trimmed));
                
                if (isSkipComment) {
                    // Find matching context in existing file
                    // Look ahead to find context from next non-skip lines
                    let contextLines = [];
                    for (let j = i + 1; j < Math.min(i + 5, editLines.length); j++) {
                        const nextLine = editLines[j];
                        const nextTrimmed = nextLine.trim();
                        if (!skipCommentPatterns.some(pattern => pattern.test(nextTrimmed))) {
                            contextLines.push(nextLine);
                            if (contextLines.length >= 3) break;
                        }
                    }
                    
                    // Search for matching context in existing file
                    let foundMatch = false;
                    if (contextLines.length > 0) {
                        for (let k = existingIndex; k < existingLines.length; k++) {
                            // Check if context matches
                            let matches = true;
                            for (let l = 0; l < contextLines.length && k + l < existingLines.length; l++) {
                                if (existingLines[k + l] !== contextLines[l]) {
                                    matches = false;
                                    break;
                                }
                            }
                            
                            if (matches) {
                                // Found match - skip to this position
                                existingIndex = k;
                                foundMatch = true;
                                break;
                            }
                        }
                    }
                    
                    if (!foundMatch) {
                        // If no match found, try to find by looking backward for previous context
                        if (i > 0) {
                            const prevLines = [];
                            for (let j = Math.max(0, i - 3); j < i; j++) {
                                const prevLine = editLines[j];
                                const prevTrimmed = prevLine.trim();
                                if (!skipCommentPatterns.some(pattern => pattern.test(prevTrimmed))) {
                                    prevLines.push(editLines[j]);
                                }
                            }
                            
                            if (prevLines.length > 0) {
                                // Search backward from current position
                                for (let k = existingIndex; k < existingLines.length; k++) {
                                    let matches = true;
                                    for (let l = 0; l < prevLines.length && k + l < existingLines.length; l++) {
                                        if (existingLines[k + l] !== prevLines[l]) {
                                            matches = false;
                                            break;
                                        }
                                    }
                                    if (matches) {
                                        existingIndex = k + prevLines.length;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Regular edit line - check if it matches existing or is new
                    if (existingIndex < existingLines.length && existingLines[existingIndex] === editLine) {
                        // Line matches existing - keep it
                        resultLines.push(editLine);
                        existingIndex++;
                    } else {
                        // New or modified line - add it
                        resultLines.push(editLine);
                        // Try to advance existing index if we can find a match ahead
                        if (existingIndex < existingLines.length) {
                            // Simple heuristic: if next edit line matches, advance
                            if (i + 1 < editLines.length) {
                                const nextEdit = editLines[i + 1];
                                const nextTrimmed = nextEdit.trim();
                                if (!skipCommentPatterns.some(pattern => pattern.test(nextTrimmed))) {
                                    // Look ahead for match
                                    for (let k = existingIndex + 1; k < Math.min(existingIndex + 10, existingLines.length); k++) {
                                        if (existingLines[k] === nextEdit) {
                                            // Found match ahead - skip existing lines
                                            while (existingIndex < k) {
                                                resultLines.push(existingLines[existingIndex]);
                                                existingIndex++;
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // Add any remaining existing lines
            while (existingIndex < existingLines.length) {
                resultLines.push(existingLines[existingIndex]);
                existingIndex++;
            }
            
            // Write the result
            const newContent = resultLines.join('\n');
            fs.writeFileSync(fullPath, newContent, 'utf8');
            
            const result = { success: true, action: 'edited' };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Apply unified diff/patch format to file content
     * @param {string} originalContent - Original file content
     * @param {string} diffText - Unified diff text
     * @returns {string} - Patched content
     */
    applyUnifiedDiff(originalContent, diffText) {
        const originalLines = originalContent.split('\n');
        const diffLines = diffText.split('\n');
        const resultLines = [];
        let originalIndex = 0;
        
        // Find all hunks (sections between @@ markers)
        const hunks = [];
        let currentHunk = null;
        
        for (let i = 0; i < diffLines.length; i++) {
            const line = diffLines[i];
            const hunkHeaderMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            
            if (hunkHeaderMatch) {
                // Save previous hunk if exists
                if (currentHunk) {
                    hunks.push(currentHunk);
                }
                
                // Start new hunk
                const oldStart = parseInt(hunkHeaderMatch[1]) - 1; // Convert to 0-based index
                const oldCount = parseInt(hunkHeaderMatch[2] || '1');
                const newStart = parseInt(hunkHeaderMatch[3]) - 1; // Convert to 0-based index
                const newCount = parseInt(hunkHeaderMatch[4] || '1');
                
                currentHunk = {
                    oldStart: oldStart,
                    oldEnd: oldStart + oldCount,
                    lines: []
                };
            } else if (currentHunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
                // Add line to current hunk
                currentHunk.lines.push(line);
            }
        }
        
        // Add last hunk
        if (currentHunk) {
            hunks.push(currentHunk);
        }
        
        // Apply each hunk
        for (const hunk of hunks) {
            // Copy lines before hunk (up to hunk.oldStart)
            while (originalIndex < hunk.oldStart && originalIndex < originalLines.length) {
                resultLines.push(originalLines[originalIndex]);
                originalIndex++;
            }
            
            // Process hunk lines
            // Track position in original file within this hunk
            let hunkOriginalIndex = originalIndex;
            
            for (const line of hunk.lines) {
                if (line.startsWith(' ')) {
                    // Context line (unchanged) - should match existing line
                    const content = line.substring(1); // Remove leading space
                    if (hunkOriginalIndex < originalLines.length && originalLines[hunkOriginalIndex] === content) {
                        resultLines.push(content);
                        hunkOriginalIndex++;
                        originalIndex++;
                    } else {
                        // Context doesn't match exactly - still apply it but warn
                        // In practice, this shouldn't happen if the diff is correct
                        resultLines.push(content);
                        if (hunkOriginalIndex < originalLines.length) {
                            hunkOriginalIndex++;
                            originalIndex++;
                        }
                    }
                } else if (line.startsWith('-')) {
                    // Deletion - skip this line in original
                    if (hunkOriginalIndex < originalLines.length) {
                        hunkOriginalIndex++;
                        originalIndex++;
                    }
                } else if (line.startsWith('+')) {
                    // Addition - add new line (don't advance original index)
                    const content = line.substring(1); // Remove leading +
                    resultLines.push(content);
                }
            }
            
            // Ensure originalIndex is at the correct position after processing hunk
            // We've already advanced originalIndex while processing hunk lines
            // Just need to make sure we're at the right position
            originalIndex = hunkOriginalIndex;
        }
        
        // Copy remaining lines after last hunk
        while (originalIndex < originalLines.length) {
            resultLines.push(originalLines[originalIndex]);
            originalIndex++;
        }
        
        return resultLines.join('\n');
    }

    /**
     * Execute delete_file tool
     */
    async executeDeleteFile(args) {
        const toolName = 'delete_file';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { target_file } = args;
            const fullPath = path.isAbsolute(target_file) ? target_file : path.join(process.cwd(), target_file);
            
            if (this.mode === 'ask') {
                throw new Error('delete_file is not allowed in ask mode');
            }
            
            if (!fs.existsSync(fullPath)) {
                const result = { success: true, message: 'File does not exist' };
                this.emit('tool:complete', { toolName, args, result });
                return result;
            }
            
            fs.unlinkSync(fullPath);
            const result = { success: true };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Execute llm_chat tool
     */
    async executeLLMChat(args) {
        const toolName = 'llm_chat';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { model, messages } = args;
            const result = await this.callLLM(model, messages);
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
    }

    /**
     * Find LLM engine by name
     */
    findEngine(modelName) {
        const engine = this.engines.find(e => e.name === modelName);
        if (!engine) {
            throw new Error(`Model "${modelName}" not found in llm-engines.json. Available models: ${this.engines.map(e => e.name).join(', ')}`);
        }
        return engine;
    }

    /**
     * Make LLM API call with function calling support
     * @param {string} modelName - Name of the model to use
     * @param {Array} messages - Array of messages
     * @param {Object} options - Options including temperature, max_tokens, skipTools (don't include tools), skipSystemPrompt (don't prepend system prompt)
     */
    async callLLM(modelName, messages, options = {}) {
        const engine = this.findEngine(modelName);
        const apiKey = readAPIKey(engine.keyPath);

        // Prepare tools for function calling (unless skipTools is true)
        let tools = [];
        if (!options.skipTools) {
            tools = this.tools.map(tool => {
                const func = tool.function || tool;
                return {
                    type: 'function',
                    function: {
                        name: func.name,
                        description: func.description,
                        parameters: this.parseParameters(func.parameters)
                    }
                };
            });
        }

        const url = `${engine.baseUrl}/chat/completions`;
        
        const requestBody = {
            model: engine.model,
            messages: messages,
            ...(tools.length > 0 && { tools }),
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.max_tokens !== undefined && { max_tokens: options.max_tokens })
        };

        // Log request
        if (this.onRequest) {
            this.onRequest({ model: modelName, messages: messages, tools });
        }
        this.emit('request', { model: modelName, messages: messages, tools });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LLM API error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            
            // Log response
            if (this.onResponse) {
                this.onResponse(data);
            }
            this.emit('response', data);

            return data;
        } catch (error) {
            if (error.message.includes('fetch')) {
                throw new Error(`Network error: ${error.message}. Make sure you have Node.js 18+ with fetch support.`);
            }
            throw error;
        }
    }

    /**
     * Parse parameters from string format to JSON schema
     */
    parseParameters(params) {
        if (typeof params === 'string') {
            try {
                return JSON.parse(params);
            } catch {
                // If parsing fails, return as-is
                return params;
            }
        }
        return params;
    }

    /**
     * Process LLM response and execute tool calls
     */
    async processResponse(response, conversationHistory = []) {
        const choice = response.choices?.[0];
        if (!choice) {
            throw new Error('Invalid response format from LLM API');
        }

        const message = choice.message;
        conversationHistory.push(message);

        // Check for tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
            const toolResults = [];
            
            // Execute all tool calls (can be parallel if independent)
            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                let toolArgs;
                
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments);
                } catch (error) {
                    toolArgs = toolCall.function.arguments;
                }

                try {
                    const result = await this.toolRegistry.get(toolName)(toolArgs);
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify(result)
                    });
                } catch (error) {
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify({ error: error.message })
                    });
                }
            }

            // Add tool results to conversation
            conversationHistory.push(...toolResults);

            // Continue conversation with tool results
            return await this.continueConversation(conversationHistory);
        }

        return {
            content: message.content,
            conversationHistory
        };
    }

    /**
     * Continue conversation after tool execution
     */
    async continueConversation(messages) {
        const response = await this.callLLM(this.model, messages);
        return await this.processResponse(response, messages);
    }

    /**
     * Chat with LLM (main entry point)
     */
    async chat(messages, message, options = {}) {
        if (!messages) {
            messages = [];
        }
        // If the first message is not a system prompt, prepend the appropriate one
        if (messages.length === 0 || messages[0].role !== 'system') {
            messages.unshift({
                role: 'system',
                content: this.systemPrompt
            });
        }
        messages.push({ role: 'user', content: message });
        if (this.mode === "ask") {
            messages[messages.length - 1].content += `\n\n${this.readonlyPrompt}`;
        }
        let iteration = 0;

        while (iteration < this.maxIterations) {
            const response = await this.callLLM(this.model, messages, options);
            const result = await this.processResponse(response, messages);
            
            messages = result.conversationHistory;

            // If no tool calls were made, return the final response
            if (result.content) {
                return {
                    content: result.content,
                    conversationHistory: result.conversationHistory
                };
            }

            iteration++;
        }

        throw new Error(`Maximum iterations (${this.maxIterations}) reached`);
    }

    /**
     * Set mode (ask or agent)
     */
    setMode(mode) {
        if (mode !== 'ask' && mode !== 'agent') {
            throw new Error('Mode must be "ask" or "agent"');
        }
        this.mode = mode;
        this.tools = this.filterTools(this.allTools, mode);
    }
}

module.exports = LLMClient;

