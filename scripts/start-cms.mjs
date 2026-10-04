import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

export function localProxyOptions() {
  const configCount = Number(process.env.GIT_CONFIG_COUNT || 0);
  return {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '8081',
      BIND_HOST: '127.0.0.1',
      ORIGIN: '',
      GIT_CONFIG_COUNT: String(configCount + 1),
      [`GIT_CONFIG_KEY_${configCount}`]: 'safe.directory',
      [`GIT_CONFIG_VALUE_${configCount}`]: root.replaceAll('\\', '/')
    }
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const proxy = spawn(process.execPath, [require.resolve('decap-server')], localProxyOptions());
  proxy.on('error', error => { console.error(error.message); process.exitCode = 1; });
  proxy.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => proxy.kill(signal));
}