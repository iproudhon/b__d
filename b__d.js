#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * b__d.js - Self-evolving project tool for creating/updating spec files using LLM
 */

// Configuration
const LLM_ENGINES_FILE = path.join(__dirname, 'llm-engines.json');
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
 * Load LLM engine configuration
 */
function loadLLMEngines() {
    return readJSON(LLM_ENGINES_FILE);
}

/**
 * Find LLM engine by name
 */
function findEngine(engines, modelName) {
    const engine = engines.find(e => e.name === modelName);
    if (!engine) {
        throw new Error(`Model "${modelName}" not found in llm-engines.json. Available models: ${engines.map(e => e.name).join(', ')}`);
    }
    return engine;
}

/**
 * Make LLM API call
 */
async function callLLM(modelName, messages) {
    const engines = loadLLMEngines();
    const engine = findEngine(engines, modelName);
    const apiKey = readAPIKey(engine.keyPath);

    const url = `${engine.baseUrl}/chat/completions`;
    
    const requestBody = {
        model: engine.model,
        messages: messages
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                ...(engine.baseUrl.includes('openrouter.ai') && {
                    'HTTP-Referer': 'https://github.com/yourusername/b__d',
                    'X-Title': 'b__d'
                })
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response format from LLM API');
        }

        return data.choices[0].message.content;
    } catch (error) {
        if (error.message.includes('fetch')) {
            throw new Error(`Network error: ${error.message}. Make sure you have Node.js 18+ with fetch support, or install node-fetch.`);
        }
        throw error;
    }
}

/**
 * Create or update a spec file using LLM
 */
async function createOrUpdateSpec(specPath, prompt, modelName = DEFAULT_MODEL) {
    const fullSpecPath = path.isAbsolute(specPath) ? specPath : path.join(__dirname, specPath);
    const specDir = path.dirname(fullSpecPath);
    
    // Ensure directory exists
    if (!fs.existsSync(specDir)) {
        fs.mkdirSync(specDir, { recursive: true });
    }

    // Read existing spec if it exists
    let existingContent = '';
    if (fs.existsSync(fullSpecPath)) {
        existingContent = fs.readFileSync(fullSpecPath, 'utf8');
    }

    // Prepare messages for LLM
    const messages = [
        {
            role: 'system',
            content: 'You are a helpful assistant that creates and updates specification files. Provide clear, well-structured specifications in markdown format.'
        }
    ];

    if (existingContent) {
        messages.push({
            role: 'user',
            content: `Here is the existing spec file content:\n\n${existingContent}\n\n${prompt}\n\nPlease update the spec file accordingly. Maintain the existing structure and style where appropriate, but make the requested changes.`
        });
    } else {
        messages.push({
            role: 'user',
            content: `${prompt}\n\nPlease create a comprehensive spec file in markdown format.`
        });
    }

    console.log(`Calling LLM (${modelName}) to ${existingContent ? 'update' : 'create'} spec file: ${specPath}...`);
    
    const newContent = await callLLM(modelName, messages);
    
    // Write the updated spec file
    fs.writeFileSync(fullSpecPath, newContent, 'utf8');
    console.log(`✓ Spec file ${existingContent ? 'updated' : 'created'}: ${specPath}`);
    
    return newContent;
}

/**
 * Main CLI interface
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
Usage: node b__d.js <command> [options]

Commands:
  spec <path> <prompt> [--model <model-name>]
    Create or update a spec file at <path> using LLM based on <prompt>
    
    Examples:
      node b__d.js spec PROJECT.md "Add a new feature for video analysis"
      node b__d.js spec specs/api.md "Create API specification" --model gpt-4.1-mini

  list-models
    List all available LLM models from llm-engines.json

  chat <model> <message>
    Have a simple chat with an LLM model
    
    Example:
      node b__d.js chat openrouter/gemini-2.5-pro "What is machine learning?"
`);
        process.exit(0);
    }

    const command = args[0];

    try {
        switch (command) {
            case 'spec': {
                if (args.length < 3) {
                    throw new Error('Usage: spec <path> <prompt> [--model <model-name>]');
                }
                
                const specPath = args[1];
                const prompt = args[2];
                let modelName = DEFAULT_MODEL;
                
                // Parse --model flag
                const modelIndex = args.indexOf('--model');
                if (modelIndex !== -1 && args[modelIndex + 1]) {
                    modelName = args[modelIndex + 1];
                }
                
                await createOrUpdateSpec(specPath, prompt, modelName);
                break;
            }
            
            case 'list-models': {
                const engines = loadLLMEngines();
                console.log('\nAvailable LLM models:');
                engines.forEach(engine => {
                    console.log(`  - ${engine.name} (${engine.model})`);
                });
                break;
            }
            
            case 'chat': {
                if (args.length < 3) {
                    throw new Error('Usage: chat <model> <message>');
                }
                
                const modelName = args[1];
                const message = args.slice(2).join(' ');
                
                const response = await callLLM(modelName, [
                    { role: 'user', content: message }
                ]);
                
                console.log('\n' + response + '\n');
                break;
            }
            
            default:
                throw new Error(`Unknown command: ${command}`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error(`Fatal error: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    callLLM,
    createOrUpdateSpec,
    loadLLMEngines
};

