// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
// Simulation-only runtime injected using eth_call state overrides. NEVER deploy/fund.
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address,uint256) external returns (bool);
}
interface IWETH is IERC20 { function deposit() external payable; }
interface IV2 {
    function swapExactTokensForTokens(uint256,uint256,address[] calldata,address,uint256) external returns(uint256[] memory);
}
interface IV3 {
    struct Params {address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;}
    function exactInputSingle(Params calldata) external payable returns(uint256);
}
contract Probe {
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    struct Leg {address router; uint24 fee; bool v3;}
    function swap(Leg calldata leg,address tokenIn,address tokenOut,uint256 amount) internal {
        require(leg.router == 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D ||
                leg.router == 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F ||
                leg.router == 0xE592427A0AEce92De3Edee1F18E0157C05861564, "router");
        require(IERC20(tokenIn).approve(leg.router,0), "approve reset");
        require(IERC20(tokenIn).approve(leg.router,amount), "approve");
        if(leg.v3) {
            IV3(leg.router).exactInputSingle(IV3.Params(tokenIn,tokenOut,leg.fee,address(this),block.timestamp,amount,0,0));
        } else {
            address[] memory path = new address[](2); path[0]=tokenIn; path[1]=tokenOut;
            IV2(leg.router).swapExactTokensForTokens(amount,0,path,address(this),block.timestamp);
        }
    }
    function run(address token,uint256 amount,Leg calldata buy,Leg calldata sell) external returns(uint256 output,uint256 gasUsed) {
        uint256 start = gasleft();
        uint256 beforeWeth = IERC20(WETH).balanceOf(address(this));
        uint256 beforeToken = IERC20(token).balanceOf(address(this));
        IWETH(WETH).deposit{value:amount}();
        swap(buy,WETH,token,amount);
        uint256 acquired = IERC20(token).balanceOf(address(this))-beforeToken;
        swap(sell,token,WETH,acquired);
        output = IERC20(WETH).balanceOf(address(this))-beforeWeth;
        gasUsed = start-gasleft();
    }
}
