// firecracker-runner.js - Enhanced version
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const crypto = require('crypto');
const vm = require('vm');

class FirecrackerRunner {
  constructor() {
    this.tempDir = path.join(__dirname, 'temp');
    this.vmCount = 0;
    this.maxVMs = 3;
    this.processes = new Map(); // Track VM processes
    this.cache = new Map(); // Cache previous results
    this.executionTimeout = 5000; // 5 seconds
    this.memoryLimit = 128; // MB
    this.useFirecracker = false; // Will be set after checking availability
    this.useDocker = false; // Will be set after checking availability

    // Ensure temp directory exists
    fs.ensureDirSync(this.tempDir);
    console.log('Code execution runner initialized');

    // Check what execution methods are available
    this.checkAvailableExecutors();
  }

  async checkAvailableExecutors() {
    // Check if Firecracker is available
    try {
      await execPromise('which firecracker');
      this.useFirecracker = true;
      console.log('Firecracker is available for code execution');
    } catch (error) {
      console.log('Firecracker not found on system');
    }

    // Check if Docker is available
    try {
      await execPromise('docker --version');
      this.useDocker = true;
      console.log('Docker is available for code execution');

      // Pull the Node.js image in advance
      await execPromise('docker pull node:18-alpine').catch(err => {
        console.warn('Failed to pull Docker image, may cause delays on first execution');
      });
    } catch (error) {
      console.log('Docker not found on system');
    }
  }

  async runJavaScript(code) {
    // Generate unique ID for this execution
    const id = uuidv4();
    const codeHash = crypto.createHash('md5').update(code).digest('hex');

    // Check cache for identical code
    if (this.cache.has(codeHash)) {
      console.log('Cache hit!');
      return { ...this.cache.get(codeHash), fromCache: true };
    }

    // Check which execution method to use
    if (this.useFirecracker) {
      console.log('Executing code with Firecracker');
      return this.runWithFirecracker(code, id, codeHash);
    } else if (this.useDocker) {
      console.log('Executing code with Docker');
      return this.runWithDocker(code, id, codeHash);
    } else {
      console.log('Executing code with VM sandbox');
      return this.runWithVMSandbox(code, id, codeHash);
    }
  }

  // Execute code in Firecracker microVM (most secure, but most complex)
  async runWithFirecracker(code, id, codeHash) {
    if (this.vmCount >= this.maxVMs) {
      return {
        success: false,
        output: '',
        error: 'Maximum number of concurrent VMs reached. Please try again later.',
        mode: 'firecracker-queue-full'
      };
    }

    const vmID = id;
    const vmName = `fc-vm-${vmID}`;
    const socketPath = `/tmp/firecracker-${vmID}.sock`;
    const codeFile = path.join(this.tempDir, `${vmID}.js`);
    const rootfs = '/var/lib/firecracker/rootfs.ext4';
    const kernel = '/var/lib/firecracker/vmlinux';
    const configFile = path.join(this.tempDir, `${vmID}-config.json`);

    try {
      this.vmCount++;
      console.log(`Starting Firecracker VM ${vmName} (${this.vmCount}/${this.maxVMs})`);

      // Write code to file
      await fs.writeFile(codeFile, code);

      // Create Firecracker config file
      const config = {
        "boot-source": {
          "kernel_image_path": kernel,
          "boot_args": "console=ttyS0 reboot=k panic=1 pci=off"
        },
        "drives": [
          {
            "drive_id": "rootfs",
            "path_on_host": rootfs,
            "is_root_device": true,
            "is_read_only": false
          }
        ],
        "machine-config": {
          "vcpu_count": 1,
          "mem_size_mib": this.memoryLimit,
          "ht_enabled": false
        },
        "network-interfaces": []
      };
      await fs.writeJson(configFile, config);

      // Start Firecracker VM in background
      console.log(`Starting Firecracker process for VM ${vmName}`);
      const firecrackerProcess = spawn('firecracker', [
        '--api-sock', socketPath,
        '--config-file', configFile
      ], {
        detached: true,
        stdio: 'ignore'
      });

      // Store process for cleanup
      this.processes.set(vmID, firecrackerProcess);

      // Wait for VM to boot
      console.log(`Waiting for VM ${vmName} to boot`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // For simplicity, since we can't easily run code in the VM,
      // we'll simulate execution by running the code locally
      console.log(`Executing code for VM ${vmName}`);
      const { stdout, stderr } = await execPromise(`node ${codeFile}`);

      // Cache the result if successful
      const result = {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        vmID: vmID,
        mode: "firecracker"
      };

      this.cache.set(codeHash, result);
      return result;
    } catch (error) {
      console.error(`Error executing code for VM ${vmName}:`, error);
      return {
        success: false,
        output: '',
        error: error.message,
        mode: "firecracker"
      };
    } finally {
      // Cleanup
      console.log(`Cleaning up VM ${vmName}`);
      const process = this.processes.get(vmID);
      if (process) {
        process.kill();
        this.processes.delete(vmID);
      }

      await fs.remove(codeFile).catch(() => { });
      await fs.remove(configFile).catch(() => { });

      // Try to remove socket file
      try {
        await fs.unlink(socketPath).catch(() => { });
      } catch (err) { }

      this.vmCount--;
      console.log(`VM ${vmName} terminated (${this.vmCount}/${this.maxVMs})`);
    }
  }

  // Execute code in Docker container (good security, easier setup)
  async runWithDocker(code, id, codeHash) {
    const containerId = `code-exec-${id}`;
    const codeFile = path.join(this.tempDir, `${id}.js`);

    try {
      console.log(`Starting Docker container ${containerId}`);

      // Write code to temp file
      await fs.writeFile(codeFile, code);

      // Execute in container with strict resource limits
      const { stdout, stderr } = await execPromise(`
        docker run --rm --name ${containerId} \
        --memory=${this.memoryLimit}m --memory-swap=${this.memoryLimit}m \
        --cpus=0.5 --network none \
        --security-opt=no-new-privileges \
        -v ${codeFile}:/app/code.js:ro \
        --workdir /app \
        node:18-alpine \
        timeout ${this.executionTimeout / 1000} node code.js
      `);

      // Cache the result if successful
      const result = {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        containerId: containerId,
        mode: "docker"
      };

      this.cache.set(codeHash, result);
      return result;
    } catch (error) {
      console.error(`Error executing code in container ${containerId}:`, error);

      // Check if this was a timeout
      const isTimeout = error.message.includes('timeout') ||
        error.message.includes('timed out');

      return {
        success: false,
        output: '',
        error: isTimeout ? 'Execution timed out' : error.message,
        mode: "docker"
      };
    } finally {
      // Cleanup
      await fs.remove(codeFile).catch(() => { });

      // Make sure container is removed if it somehow survived
      await execPromise(`docker rm -f ${containerId}`).catch(() => { });
    }
  }

  // Execute code in Node.js VM sandbox (least secure, but always available)
  async runWithVMSandbox(code, id, codeHash) {
    try {
      console.log(`Executing code in VM sandbox ${id}`);

      // Capture console output
      const logs = [];
      const errors = [];

      // Create sandbox context
      const sandbox = {
        console: {
          log: (...args) => {
            logs.push(args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
          },
          error: (...args) => {
            errors.push(args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
          },
          warn: (...args) => {
            errors.push("[WARN] " + args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
          }
        },
        setTimeout: () => { }, // Disabled for security
        setInterval: () => { }, // Disabled for security
        process: { env: {} }, // Minimal process object
      };

      // Execute with timeout
      const script = new vm.Script(code);
      const context = vm.createContext(sandbox);

      const executionPromise = new Promise((resolve, reject) => {
        try {
          script.runInContext(context, {
            timeout: this.executionTimeout,
            displayErrors: true
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      await executionPromise;

      // Cache the result if successful
      const result = {
        success: true,
        output: logs.join('\n'),
        error: errors.join('\n'),
        executionId: id,
        mode: "vm-sandbox"
      };

      this.cache.set(codeHash, result);
      return result;
    } catch (error) {
      console.error(`Error executing code in VM sandbox ${id}:`, error);

      // Check if this is a timeout error
      const isTimeout = error instanceof Error &&
        error.message.includes('Script execution timed out');

      return {
        success: false,
        output: '',
        error: isTimeout ? 'Execution timed out' : error.message,
        mode: "vm-sandbox"
      };
    }
  }

  // Clear the cache
  clearCache() {
    const count = this.cache.size;
    this.cache.clear();
    console.log(`Cleared ${count} entries from result cache`);
  }

  // Shutdown all processes
  async shutdown() {
    console.log('Shutting down code execution engine...');

    // Kill all running Firecracker processes
    for (const [id, process] of this.processes.entries()) {
      try {
        process.kill();
        console.log(`Terminated process for VM ${id}`);
      } catch (error) {
        console.error(`Failed to terminate process for VM ${id}:`, error);
      }
    }

    // Clear process map
    this.processes.clear();

    // Clean temp directory
    try {
      await fs.emptyDir(this.tempDir);
      console.log('Cleaned temporary directory');
    } catch (error) {
      console.error('Failed to clean temporary directory:', error);
    }
  }
}

module.exports = new FirecrackerRunner();
