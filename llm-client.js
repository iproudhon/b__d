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
     */
    async executeReadLints(args) {
        const toolName = 'read_lints';
        this.emit('tool:start', { toolName, args });
        
        try {
            const { paths = [] } = args;
            // Basic implementation - returns empty lints for now
            // Could be extended to integrate with ESLint or other linters
            const result = { lints: [] };
            this.emit('tool:complete', { toolName, args, result });
            return result;
        } catch (error) {
            this.emit('tool:error', { toolName, args, error: error.message });
            throw error;
        }
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

