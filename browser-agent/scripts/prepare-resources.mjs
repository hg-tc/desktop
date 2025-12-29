import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const RESOURCES_DIR = path.join(ROOT, 'resources');
const PY_RUNTIME_DIR = path.join(RESOURCES_DIR, 'python-runtime');
const PY_SITE_PACKAGES_DIR = path.join(RESOURCES_DIR, 'python-site-packages');
const XHS_OUT_DIR = path.join(RESOURCES_DIR, 'xiaohongshu-mcp');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
}

function hasCommand(cmd) {
  const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return res.status === 0;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'browser-agent-build',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return await res.json();
}

function resolvePythonBuildStandaloneTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';

  throw new Error(`Unsupported platform/arch for python-build-standalone: ${platform}/${arch}`);
}

function resolveEmbeddedPythonExecutableFromResources() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(PY_RUNTIME_DIR, 'python.exe'));
  } else {
    candidates.push(path.join(PY_RUNTIME_DIR, 'bin', 'python3'));
    candidates.push(path.join(PY_RUNTIME_DIR, 'bin', 'python'));
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      continue;
    }
  }
  return null;
}

async function ensurePythonRuntime() {
  if (fs.existsSync(PY_RUNTIME_DIR) && fs.readdirSync(PY_RUNTIME_DIR).length > 0) {
    console.log(`[resources] python-runtime exists: ${PY_RUNTIME_DIR}`);
    return;
  }

  ensureDir(PY_RUNTIME_DIR);

  const targetTriple = resolvePythonBuildStandaloneTarget();
  const majorMinor = process.env.PYTHON_RUNTIME_VERSION || '3.11';

  const release = await fetchJson('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
  const assets = Array.isArray(release.assets) ? release.assets : [];

  const preferZstd = hasCommand('zstd');

  const candidates = assets
    .filter((a) => typeof a?.name === 'string')
    .filter((a) => a.name.includes(`cpython-${majorMinor}`))
    .filter((a) => a.name.includes(targetTriple))
    .filter((a) => a.name.includes('install_only'))
    .filter((a) => a.name.endsWith('.tar.zst') || a.name.endsWith('.tar.gz'))
    .sort((a, b) => {
      const aZ = a.name.endsWith('.tar.zst');
      const bZ = b.name.endsWith('.tar.zst');
      if (aZ !== bZ) {
        if (preferZstd) return aZ ? -1 : 1;
        return aZ ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

  if (candidates.length === 0) {
    throw new Error(`Cannot find python-build-standalone asset for ${majorMinor} ${targetTriple}.`);
  }

  const asset = candidates[0];
  const downloadUrl = asset.browser_download_url;
  if (typeof downloadUrl !== 'string' || !downloadUrl) {
    throw new Error('Invalid browser_download_url for python runtime asset');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-agent-py-'));
  const archivePath = path.join(tmpDir, asset.name);

  console.log(`[resources] downloading python runtime: ${asset.name}`);
  run('curl', ['-L', '-o', archivePath, downloadUrl]);

  console.log('[resources] extracting python runtime...');
  if (asset.name.endsWith('.tar.zst')) {
    if (!preferZstd) {
      throw new Error("zstd not found in PATH but selected asset is .tar.zst; install zstd or use a .tar.gz asset");
    }
    run('zstd', ['-d', archivePath, '-o', `${archivePath}.tar`]);
    run('tar', ['-xf', `${archivePath}.tar`, '-C', PY_RUNTIME_DIR, '--strip-components=1']);
  } else if (asset.name.endsWith('.tar.gz')) {
    run('tar', ['-xzf', archivePath, '-C', PY_RUNTIME_DIR, '--strip-components=1']);
  } else {
    throw new Error(`Unsupported archive format for python runtime: ${asset.name}. Expected .tar.zst/.tar.gz`);
  }

  console.log(`[resources] python runtime ready: ${PY_RUNTIME_DIR}`);
}

function ensurePythonSitePackages() {
  const requirementsPath = path.join(ROOT, 'python', 'requirements.txt');
  if (!fs.existsSync(requirementsPath)) {
    console.warn(`[resources] skip python deps install (missing requirements.txt): ${requirementsPath}`);
    return;
  }

  if (fs.existsSync(PY_SITE_PACKAGES_DIR) && fs.readdirSync(PY_SITE_PACKAGES_DIR).length > 0) {
    console.log(`[resources] python-site-packages exists: ${PY_SITE_PACKAGES_DIR}`);
    return;
  }

  ensureDir(PY_SITE_PACKAGES_DIR);

  const py = resolveEmbeddedPythonExecutableFromResources();
  if (!py) {
    throw new Error(`Cannot find embedded python executable under ${PY_RUNTIME_DIR}. Run prepare:resources again.`);
  }

  console.log('[resources] ensuring pip...');
  run(py, ['-m', 'ensurepip', '--upgrade']);

  console.log('[resources] upgrading pip...');
  run(py, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);

  console.log('[resources] installing python deps into resources/python-site-packages...');
  run(py, ['-m', 'pip', 'install', '--no-warn-script-location', '--disable-pip-version-check', '-r', requirementsPath, '--target', PY_SITE_PACKAGES_DIR]);

  console.log(`[resources] python deps ready: ${PY_SITE_PACKAGES_DIR}`);
}

function ensureXhsMcpBinary() {
  ensureDir(XHS_OUT_DIR);

  const exeName = process.platform === 'win32' ? 'xiaohongshu-mcp.exe' : 'xiaohongshu-mcp';
  const outPath = path.join(XHS_OUT_DIR, exeName);
  if (fs.existsSync(outPath)) {
    console.log(`[resources] xiaohongshu-mcp exists: ${outPath}`);
    return;
  }

  const srcDir = path.resolve(ROOT, '..', 'xiaohongshu-mcp');
  if (!fs.existsSync(srcDir)) {
    console.warn(`[resources] skip building xiaohongshu-mcp (source not found): ${srcDir}`);
    return;
  }

  console.log('[resources] building xiaohongshu-mcp...');
  run('go', ['build', '-o', outPath, '.'], { cwd: srcDir, env: { ...process.env } });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(outPath, 0o755);
    } catch {
      // ignore
    }
  }
}

async function main() {
  ensureDir(RESOURCES_DIR);
  await ensurePythonRuntime();
  ensurePythonSitePackages();
  ensureXhsMcpBinary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
