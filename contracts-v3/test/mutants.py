import subprocess,sys,os
M=[
("M1 payout paused","src/FavourPots.sol","        onlyOperatorOrAdmin\n        nonReentrant\n    {\n        Campaign storage c = _campaign(id);\n        if (c.closed) revert CampaignClosed();\n        if (c.frozen","        onlyOperatorOrAdmin\n        nonReentrant\n        whenNotPaused\n    {\n        Campaign storage c = _campaign(id);\n        if (c.closed) revert CampaignClosed();\n        if (c.frozen"),
("M2 fee cap 50%","src/ManagedUpgradeable.sol","MAX_FEE_BPS = 1000;","MAX_FEE_BPS = 5000;"),
("M3 no upgrade delay","src/ManagedUpgradeable.sol","UPGRADE_DELAY = 6 hours;","UPGRADE_DELAY = 0;"),
("M4 admin redirects escrow","src/FavourPots.sol","if (msg.sender != fv.funder && (fv.releaser","if (msg.sender != fv.funder && !_isAdmin(msg.sender) && (fv.releaser"),
("M5 owed not reduced","src/ManagedUpgradeable.sol","        _ms().owed[token] -= amount;\n        IERC20(token).safeTransfer(to, amount);","        IERC20(token).safeTransfer(to, amount);"),
("M6 double refund","src/FavourPots.sol","        $.refundClaimed[id][msg.sender] = true;\n","" ),
("M7 fee not snapshotted","src/PerfectRounds.sol","uint256 fee = (pot * rd.feeBps) / BPS;","uint256 fee = (pot * feeBps()) / BPS;"),
("M8 anyone cancels early","src/PerfectRounds.sol","            if (block.timestamp <= rd.resultDeadline) revert TooEarly();\n",""),
("M9 refund pays stranger","src/FavourPots.sol","_payOut(fv.token, fv.funder, fv.amount);","_payOut(fv.token, msg.sender, fv.amount);"),
("M10 0.1 USDC min ignored","src/ManagedUpgradeable.sol","if (amount < c.minAmount || amount > c.maxAmount) revert AmountOutOfRange();","if (amount > c.maxAmount) revert AmountOutOfRange();"),
("M11 key not namespaced (F-01)","src/FavourPots.sol","id = favourId(msg.sender, key);","id = key;"),
("M12 window floor removed (F-02)","src/PerfectRounds.sol","\n                || challengeWindow < _ps().minChallengeWindow",""),
("M13 no remainder to last (F-04)","src/FavourPots.sol","if ($.refundsClaimed[id] == $.contributorCount[id]) {","if (false) {"),
]
for name,f,a,b in M:
  s=open(f).read()
  assert a in s,(name,'anchor missing')
  open(f,'w').write(s.replace(a,b,1))
  try:
    r=subprocess.run(['forge','test','--no-match-path','test/fork/*'],capture_output=True,text=True,timeout=600)
    out=r.stdout+r.stderr
    fails=[l.split('[FAIL')[1].split(']')[-1].strip()[:70] for l in out.splitlines() if '[FAIL' in l]
    status='CAUGHT' if fails else ('BUILD-FAIL' if 'Compiler run failed' in out else 'SURVIVED')
    print(f"{name}: {status} ({len(fails)} failing) e.g. {fails[:2]}")
  finally:
    open(f,'w').write(s)
