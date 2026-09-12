import solc from 'solc';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function compile() {
  const source = readFileSync(new URL('../contracts/Probe.sol', import.meta.url), 'utf8');
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { 'Probe.sol': { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'paris',
          outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object'] } },
        },
      }),
    ),
  );
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = output.contracts['Probe.sol'].Probe;
  const artifact = { abi: c.abi, code: '0x' + c.evm.deployedBytecode.object };
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../artifacts/probe.json', import.meta.url), JSON.stringify(artifact));
  return artifact;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  compile();
  console.log('Probe compiled');
}
