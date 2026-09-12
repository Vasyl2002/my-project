import { parseAbi } from 'viem';
export const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function factory() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function fee() view returns(uint24)',
  'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function getPair(address,address) view returns(address)',
  'function getPool(address,address,uint24) view returns(address)',
]);
export const mcAbi = parseAbi([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[])',
]);
