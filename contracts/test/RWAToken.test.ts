import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

// ─────────────────────────────────────────────────────────────────────────────
// Role constants — must match keccak256("...") values in RWAToken.sol.
// ethers.id() is the ethers-v6 equivalent of keccak256(toUtf8Bytes(...)).
// ─────────────────────────────────────────────────────────────────────────────
const MINTER_ROLE      = ethers.id("MINTER_ROLE");
const PAUSER_ROLE      = ethers.id("PAUSER_ROLE");
const COMPLIANCE_ROLE  = ethers.id("COMPLIANCE_ROLE");
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // bytes32(0) — OpenZeppelin's convention

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture — deployed once per loadFixture call (snapshot/reset pattern).
//
// Signers assigned:
//   admin       → holds all 4 roles (set in constructor)
//   minter      → granted MINTER_ROLE
//   pauser      → granted PAUSER_ROLE
//   compliance  → granted COMPLIANCE_ROLE
//   user1       → whitelisted regular user
//   user2       → whitelisted regular user
//   stranger    → intentionally NOT added to the whitelist
// ─────────────────────────────────────────────────────────────────────────────
async function deployRWATokenFixture() {
  const [admin, minter, pauser, compliance, user1, user2, stranger] =
    await ethers.getSigners();

  const RWAToken = await ethers.getContractFactory("RWAToken");
  const token = await RWAToken.deploy(
    "RWA Token",   // name
    "RWA",         // symbol
    1_000_000n,    // supplyCap in whole tokens (× 10^18 applied inside constructor)
    admin.address  // receives all 4 roles + auto-whitelisted
  );
  await token.waitForDeployment();

  // Delegate roles to dedicated signers.
  await token.connect(admin).grantRole(MINTER_ROLE,     minter.address);
  await token.connect(admin).grantRole(PAUSER_ROLE,     pauser.address);
  await token.connect(admin).grantRole(COMPLIANCE_ROLE, compliance.address);

  // Whitelist user1 and user2; leave stranger off the whitelist.
  await token.connect(compliance).addToWhitelist(user1.address);
  await token.connect(compliance).addToWhitelist(user2.address);

  return { token, admin, minter, pauser, compliance, user1, user2, stranger };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────
describe("RWAToken", function () {

  // ── Deployment ─────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("sets name and symbol correctly", async function () {
      const { token } = await loadFixture(deployRWATokenFixture);
      expect(await token.name()).to.equal("RWA Token");
      expect(await token.symbol()).to.equal("RWA");
    });

    it("sets supplyCap in raw units (whole tokens × 10^18)", async function () {
      const { token } = await loadFixture(deployRWATokenFixture);
      const expectedCap = 1_000_000n * 10n ** 18n;
      expect(await token.supplyCap()).to.equal(expectedCap);
    });

    it("grants all four roles to admin", async function () {
      const { token, admin } = await loadFixture(deployRWATokenFixture);
      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE,        admin.address)).to.be.true;
      expect(await token.hasRole(PAUSER_ROLE,        admin.address)).to.be.true;
      expect(await token.hasRole(COMPLIANCE_ROLE,    admin.address)).to.be.true;
    });

    it("whitelists admin at deployment", async function () {
      const { token, admin } = await loadFixture(deployRWATokenFixture);
      expect(await token.whitelist(admin.address)).to.be.true;
    });

    it("starts with zero total supply", async function () {
      const { token } = await loadFixture(deployRWATokenFixture);
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  // ── Whitelist Management ───────────────────────────────────────────────────
  describe("Whitelist Management", function () {
    it("COMPLIANCE_ROLE can add an address (user1 is whitelisted via fixture)", async function () {
      const { token, user1 } = await loadFixture(deployRWATokenFixture);
      expect(await token.whitelist(user1.address)).to.be.true;
    });

    it("COMPLIANCE_ROLE can remove an address from the whitelist", async function () {
      const { token, compliance, user1 } = await loadFixture(deployRWATokenFixture);
      await token.connect(compliance).removeFromWhitelist(user1.address);
      expect(await token.whitelist(user1.address)).to.be.false;
    });

    it("non-compliance caller cannot add to whitelist — reverts with AccessControlUnauthorizedAccount", async function () {
      const { token, user1, stranger } = await loadFixture(deployRWATokenFixture);
      await expect(
        token.connect(user1).addToWhitelist(stranger.address)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Minting ────────────────────────────────────────────────────────────────
  describe("Minting", function () {
    it("MINTER_ROLE can mint tokens to a whitelisted address", async function () {
      const { token, minter, user1 } = await loadFixture(deployRWATokenFixture);
      const amount = ethers.parseEther("1000");
      await token.connect(minter).mint(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    // ★ Required negative case 1: unauthorized mint (custom AccessControl error, not string)
    it("[NEG] unauthorized mint attempt reverts with AccessControlUnauthorizedAccount", async function () {
      const { token, user1 } = await loadFixture(deployRWATokenFixture);
      await expect(
        token.connect(user1).mint(user1.address, ethers.parseEther("1"))
      )
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, MINTER_ROLE);
    });

    // ★ Required negative case 5: supply cap exceeded
    it("[NEG] minting above supply cap reverts with SupplyCapExceeded", async function () {
      const { token, minter, user1 } = await loadFixture(deployRWATokenFixture);
      // 1 full token (1e18 wei) over the 1,000,000-token cap
      const overCap = 1_000_001n * 10n ** 18n;
      await expect(
        token.connect(minter).mint(user1.address, overCap)
      ).to.be.revertedWithCustomError(token, "SupplyCapExceeded");
    });

    it("minting exactly at the supply cap succeeds", async function () {
      const { token, minter, user1 } = await loadFixture(deployRWATokenFixture);
      const atCap = 1_000_000n * 10n ** 18n;
      await token.connect(minter).mint(user1.address, atCap);
      expect(await token.totalSupply()).to.equal(atCap);
    });

    it("mint to non-whitelisted address reverts with RecipientNotWhitelisted", async function () {
      const { token, minter, stranger } = await loadFixture(deployRWATokenFixture);
      await expect(
        token.connect(minter).mint(stranger.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
    });
  });

  // ── Burning ────────────────────────────────────────────────────────────────
  describe("Burning", function () {
    it("whitelisted holder can burn their own tokens", async function () {
      const { token, minter, user1 } = await loadFixture(deployRWATokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(minter).mint(user1.address, amount);
      await token.connect(user1).burn(amount);
      expect(await token.balanceOf(user1.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    // ★ Required negative case 2: unauthorized burn of someone else's tokens
    // adminBurn is the only mechanism to burn another address's tokens;
    // calling it without DEFAULT_ADMIN_ROLE is the clearest test of this guard.
    it("[NEG] non-admin calling adminBurn (burning someone else's tokens) reverts with AccessControlUnauthorizedAccount", async function () {
      const { token, minter, user1, user2 } = await loadFixture(deployRWATokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(minter).mint(user1.address, amount);
      // user2 has no DEFAULT_ADMIN_ROLE
      await expect(
        token.connect(user2).adminBurn(user1.address, amount)
      )
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(user2.address, DEFAULT_ADMIN_ROLE);
    });

    it("admin can force-burn tokens from another whitelisted address via adminBurn", async function () {
      const { token, admin, minter, user1 } = await loadFixture(deployRWATokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(minter).mint(user1.address, amount);
      await token.connect(admin).adminBurn(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(0n);
    });
  });

  // ── Pausing ────────────────────────────────────────────────────────────────
  describe("Pausing", function () {
    it("PAUSER_ROLE can pause the contract", async function () {
      const { token, pauser } = await loadFixture(deployRWATokenFixture);
      await token.connect(pauser).pause();
      expect(await token.paused()).to.be.true;
    });

    it("PAUSER_ROLE can unpause the contract", async function () {
      const { token, pauser } = await loadFixture(deployRWATokenFixture);
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      expect(await token.paused()).to.be.false;
    });

    // ★ Required negative case 3: unauthorized pause
    it("[NEG] unauthorized pause reverts with AccessControlUnauthorizedAccount", async function () {
      const { token, user1 } = await loadFixture(deployRWATokenFixture);
      await expect(
        token.connect(user1).pause()
      )
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, PAUSER_ROLE);
    });

    it("[NEG] transfer while paused reverts with EnforcedPause", async function () {
      const { token, minter, pauser, user1, user2 } = await loadFixture(deployRWATokenFixture);
      await token.connect(minter).mint(user1.address, ethers.parseEther("100"));
      await token.connect(pauser).pause();
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("transfers resume normally after unpause", async function () {
      const { token, minter, pauser, user1, user2 } = await loadFixture(deployRWATokenFixture);
      const amount = ethers.parseEther("100");
      await token.connect(minter).mint(user1.address, amount);
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      // Should succeed now
      await token.connect(user1).transfer(user2.address, ethers.parseEther("10"));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther("10"));
    });
  });

  // ── Transfer Restrictions ──────────────────────────────────────────────────
  describe("Transfer Restrictions", function () {
    // ★ Required negative case 4: transfer to non-whitelisted recipient
    it("[NEG] transfer to non-whitelisted address reverts with RecipientNotWhitelisted", async function () {
      const { token, minter, user1, stranger } = await loadFixture(deployRWATokenFixture);
      await token.connect(minter).mint(user1.address, ethers.parseEther("100"));
      // stranger was never added to the whitelist in the fixture
      await expect(
        token.connect(user1).transfer(stranger.address, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(token, "RecipientNotWhitelisted");
    });

    it("[NEG] transfer from a de-whitelisted (frozen) sender reverts with SenderNotWhitelisted", async function () {
      const { token, compliance, minter, user1, user2 } = await loadFixture(deployRWATokenFixture);
      await token.connect(minter).mint(user1.address, ethers.parseEther("100"));
      // Compliance freezes user1
      await token.connect(compliance).removeFromWhitelist(user1.address);
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(token, "SenderNotWhitelisted");
    });

    it("transfer between two whitelisted addresses succeeds", async function () {
      const { token, minter, user1, user2 } = await loadFixture(deployRWATokenFixture);
      const mintAmt = ethers.parseEther("100");
      const xferAmt = ethers.parseEther("40");
      await token.connect(minter).mint(user1.address, mintAmt);
      await token.connect(user1).transfer(user2.address, xferAmt);
      expect(await token.balanceOf(user1.address)).to.equal(mintAmt - xferAmt);
      expect(await token.balanceOf(user2.address)).to.equal(xferAmt);
    });
  });

  // ── Privilege Escalation ───────────────────────────────────────────────────
  describe("Privilege Escalation", function () {
    // ★ Required negative case 6: non-admin grants itself MINTER_ROLE
    it("[NEG] non-admin calling grantRole(MINTER_ROLE, self) reverts with AccessControlUnauthorizedAccount", async function () {
      const { token, user1 } = await loadFixture(deployRWATokenFixture);
      // user1 has no DEFAULT_ADMIN_ROLE; grantRole is gated on that role
      await expect(
        token.connect(user1).grantRole(MINTER_ROLE, user1.address)
      )
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("admin can legitimately grant MINTER_ROLE to another address", async function () {
      const { token, admin, stranger } = await loadFixture(deployRWATokenFixture);
      await token.connect(admin).grantRole(MINTER_ROLE, stranger.address);
      expect(await token.hasRole(MINTER_ROLE, stranger.address)).to.be.true;
    });

    it("admin can revoke a role previously granted", async function () {
      const { token, admin, minter } = await loadFixture(deployRWATokenFixture);
      await token.connect(admin).revokeRole(MINTER_ROLE, minter.address);
      expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });
  });
});
