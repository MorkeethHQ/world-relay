// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "../utils/Base.t.sol";
import {MockUSDC} from "../utils/Mocks.sol";
import {PerfectRounds} from "../../src/PerfectRounds.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract PerfectHandler is Test {
    PerfectRounds public r;
    MockUSDC public usdc;
    address public admin;
    address public operator;
    address[4] public users;
    uint256[] public rounds;
    mapping(uint256 => bytes32[]) internal attempts;

    uint256 public ghostIn;
    uint256 public ghostOut;
    uint256 public ghostPotsSettled;
    uint256 public ghostFees;
    uint256 public exitBlockedByPause;
    uint256 public settledNonEntrant; // winner not a registered attempt: must stay 0
    uint256 nonce;

    constructor(PerfectRounds _r, MockUSDC _u, address _admin, address _op) {
        r = _r;
        usdc = _u;
        admin = _admin;
        operator = _op;
        for (uint256 i; i < 4; i++) {
            users[i] = address(uint160(0xB0B + i));
            usdc.mint(users[i], 1e15);
            vm.prank(users[i]);
            usdc.approve(address(r), type(uint256).max);
        }
    }

    function _isPauseErr(bytes memory err) internal pure returns (bool) {
        return err.length >= 4 && bytes4(err) == PausableUpgradeable.EnforcedPause.selector;
    }

    function _pick(uint256 s) internal view returns (uint256) {
        return rounds[s % rounds.length];
    }

    function openRound(uint256 price, uint256 len, uint256 window) external {
        price = bound(price, 100_000, 5e6);
        len = bound(len, 1 hours, 3 days);
        window = bound(window, 1 hours, 1 days);
        uint64 close = uint64(block.timestamp + len);
        vm.prank(operator);
        try r.openRound(address(usdc), price, close, close + 2 days, uint32(window)) returns (uint256 id) {
            rounds.push(id);
        } catch {}
    }

    function buy(uint256 s, uint256 n) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        n = bound(n, 1, 100);
        uint256 cost = n * r.getRound(id).entryPrice;
        vm.prank(users[s % 4]);
        try r.buyEntries(id, n) {
            ghostIn += cost;
        } catch {}
    }

    function sponsor(uint256 s, uint256 amt) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        amt = bound(amt, 100_000, 100e6);
        vm.prank(users[(s + 1) % 4]);
        try r.sponsor(id, amt) {
            ghostIn += amt;
        } catch {}
    }

    function register(uint256 s, uint256 who) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        bytes32 h = keccak256(abi.encode(nonce++));
        vm.prank(operator);
        try r.registerAttempt(id, address(uint160(0xC0FFEE + (who % 8))), h) {
            attempts[id].push(h);
        } catch {}
    }

    function propose(uint256 s, uint256 pick, bool fake) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        bytes32 h = fake || attempts[id].length == 0 ? keccak256("never-registered") : attempts[id][pick % attempts[id].length];
        vm.prank(operator);
        try r.proposeWinner(id, h, bytes32(0)) {} catch {}
    }

    function settle(uint256 s) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        PerfectRounds.Round memory rd = r.getRound(id);
        try r.settle(id) {
            uint256 fee = (uint256(rd.pot) * rd.feeBps) / 10_000;
            ghostFees += fee;
            ghostPotsSettled += rd.pot;
            if (r.attemptPlayer(id, rd.winningAttempt) == address(0)) settledNonEntrant++;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function cancel(uint256 s, bool privileged) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        vm.prank(privileged ? admin : address(0xdead));
        try r.cancel(id) {} catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function refund(uint256 s) external {
        if (rounds.length == 0) return;
        uint256 id = _pick(s);
        address u = users[s % 4];
        uint256 b0 = usdc.balanceOf(u);
        vm.prank(u);
        try r.refund(id) {
            ghostOut += usdc.balanceOf(u) - b0;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function claim(uint256 who) external {
        address w = address(uint160(0xC0FFEE + (who % 8)));
        uint256 c = r.credits(address(usdc), w);
        vm.prank(w);
        try r.claim(address(usdc)) {
            ghostOut += c;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function withdrawFees() external {
        uint256 a = r.feesAccrued(address(usdc));
        try r.withdrawFees(address(usdc)) {
            ghostOut += a;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function setFee(uint256 bps) external {
        bps = bound(bps, 0, 1000);
        vm.prank(admin);
        r.setFee(uint16(bps), address(0xFEE));
    }

    function warp(uint256 by) external {
        vm.warp(block.timestamp + bound(by, 0, 2 days));
    }

    function togglePause(bool on) external {
        if (on && !r.paused()) {
            vm.prank(admin);
            r.pause();
        } else if (!on && r.paused()) {
            vm.prank(admin);
            r.unpause();
        }
    }

    function roundsLength() external view returns (uint256) {
        return rounds.length;
    }
}

contract PerfectInvariantTest is BaseTest {
    PerfectRounds internal r;
    PerfectHandler internal h;

    function setUp() public {
        _deployMocks();
        r = _deployPerfect(address(usdc), address(permit2));
        h = new PerfectHandler(r, usdc, admin, operator);
        targetContract(address(h));
    }

    function invariant_solvent() public view {
        assertGe(usdc.balanceOf(address(r)), r.owed(address(usdc)));
    }

    function invariant_ledger_matches_ghost() public view {
        assertEq(usdc.balanceOf(address(r)), h.ghostIn() - h.ghostOut());
    }

    function invariant_fee_never_above_cap() public view {
        assertLe(r.feeBps(), r.MAX_FEE_BPS());
        assertLe(h.ghostFees() * 10_000, h.ghostPotsSettled() * r.MAX_FEE_BPS());
        uint256 n = h.roundsLength();
        for (uint256 i; i < n; i++) {
            assertLe(r.getRound(h.rounds(i)).feeBps, r.MAX_FEE_BPS());
        }
    }

    function invariant_pause_never_blocks_exits() public view {
        assertEq(h.exitBlockedByPause(), 0);
    }

    function invariant_winner_always_registered_attempt() public view {
        assertEq(h.settledNonEntrant(), 0);
    }
}
