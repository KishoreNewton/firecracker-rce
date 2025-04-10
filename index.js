const express = require('express');
const bodyParser = require('body-parser');
const firecrackerRunner = require('./firecracker-runner');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
app.use(bodyParser.json());

// Simple response cache
const outputCache = new Map();
const crypto = require('crypto');

// Check if Firecracker is available
let firecrackerAvailable = false;

async function checkFirecracker() {
  try {
    await execPromise('which firecracker');
    console.log('Firecracker is available');
    firecrackerAvailable = true;
  } catch (error) {
    console.warn('Firecracker is not available: falling back to local execution');
    firecrackerAvailable = false;
  }
}

// Execute code locally (fallback if Firecracker is not available)
async function executeLocalJS(code) {
  const vm = require('vm');
  try {
    // Create output capture
    let output = '';
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      output += args.join(' ') + '\n';
    };

    // Run in VM context
    vm.runInNewContext(code, { console: console });

    // Restore console.log
    console.log = originalConsoleLog;

    return {
      success: true,
      output: output.trim(),
      error: '',
      mode: 'local'
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message,
      mode: 'local'
    };
  }
}

app.post('/execute', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    // For simple hello world examples, check cache
    const cacheKey = crypto.createHash('md5').update(code).digest('hex');
    if (outputCache.has(cacheKey)) {
      console.log('Cache hit!');
      return res.json(outputCache.get(cacheKey));
    }

    // Execute code
    let result;
    if (firecrackerAvailable) {
      // Try with Firecracker
      result = await firecrackerRunner.runJavaScript(code);
      result.mode = 'firecracker';
    } else {
      // Fall back to local execution
      result = await executeLocalJS(code);
    }

    // Cache successful results
    if (result.success && !result.error) {
      outputCache.set(cacheKey, result);
      // Limit cache size
      if (outputCache.size > 100) {
        // Delete oldest entry
        const firstKey = outputCache.keys().next().value;
        outputCache.delete(firstKey);
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check for Firecracker at startup
checkFirecracker();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
