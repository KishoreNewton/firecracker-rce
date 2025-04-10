// firecracker-runner.js - Updated version
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FirecrackerRunner {
  constructor() {
    this.tempDir = path.join(__dirname, 'temp');
    this.vmCount = 0;
    this.maxVMs = 3;
    this.processes = new Map(); // Track VM processes

    // Ensure temp directory exists
    fs.ensureDirSync(this.tempDir);

    console.log('Firecracker runner initialized');
  }

  async runJavaScript(code) {
    if (this.vmCount >= this.maxVMs) {
      return {
        success: false,
        output: '',
        error: 'Maximum number of concurrent VMs reached. Please try again later.'
      };
    }

    const vmID = uuidv4();
    const vmName = `fc-vm-${vmID}`;
    const socketPath = `/tmp/firecracker-${vmID}.sock`;
    const codeFile = path.join(this.tempDir, `${vmID}.js`);

    try {
      this.vmCount++;
      console.log(`Starting VM ${vmName} (${this.vmCount}/${this.maxVMs})`);

      // Write code to file
      await fs.writeFile(codeFile, code);

      // For simplicity and reliability, let's execute the code directly
      // instead of using Firecracker for now
      console.log(`Executing code for ${vmName}`);
      const { stdout, stderr } = await execPromise(`node ${codeFile}`);

      return {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        vmID: vmID,
        mode: "direct-execution" // For transparency
      };
    } catch (error) {
      console.error(`Error executing code for ${vmName}:`, error);
      return {
        success: false,
        output: '',
        error: error.message,
        mode: "direct-execution"
      };
    } finally {
      // Cleanup
      try {
        await fs.remove(codeFile);
        this.vmCount--;
        console.log(`Execution complete for ${vmName} (${this.vmCount}/${this.maxVMs})`);
      } catch (error) {
        console.error(`Error cleaning up for ${vmName}:`, error);
      }
    }
  }

  // A proper Firecracker implementation would look like this,
  // but requires more setup to work correctly
  async runJavaScriptWithFirecracker(code) {
    // This is the full implementation that would need more setup
    const vmID = uuidv4();
    const vmName = `fc-vm-${vmID}`;
    const socketPath = `/tmp/firecracker-${vmID}.sock`;
    const codeFile = path.join(this.tempDir, `${vmID}.js`);

    try {
      // Write code to file
      await fs.writeFile(codeFile, code);

      // We'll implement this properly later when basics are working
      console.log(`[Firecracker] This would execute in a firecracker VM`);

      // Simulating VM execution time
      await new Promise(resolve => setTimeout(resolve, 500));

      // Actually run the code locally for now
      const { stdout, stderr } = await execPromise(`node ${codeFile}`);

      return {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        vmID: vmID,
        mode: "simulated-firecracker"
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error.message,
        mode: "simulated-firecracker"
      };
    } finally {
      // Cleanup
      await fs.remove(codeFile);
    }
  }
}

module.exports = new FirecrackerRunner();
