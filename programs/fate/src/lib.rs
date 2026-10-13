//! FATE on-chain program (Anchor).
//!
//! This is the on-chain counterpart of `src/engine/protocol.ts`. The TypeScript
//! engine is the executable reference in this repository (simnet); this program
//! mirrors its account model, instruction set and invariants so that moving to
//! devnet is a matter of pointing the backend at a deployed program ID and
//! replacing the in-process ledger with RPC calls.
//!
//! STATUS: scaffold. It compiles against anchor-lang 0.30 in a standard Solana
//! toolchain but has NOT been built, tested or deployed in this environment
//! (no Solana toolchain available here). Do not treat it as audited or complete.
//! See README "Remaining production requirements".
//!
//! PDAs
//!   launch        = ["launch", mint]
//!   curve         = ["curve", mint]          (also the SOL reserve account)
//!   vault         = ["vault", mint]          (destiny fee vault, SOL)
//!   vault_tokens  = ["vault_tokens", mint]   (ATA owned by vault PDA; holds buyback tokens before burn)
//!   escrow        = ["escrow", mint]         (Gravity pre-graduation liquidity)
//!   rewards       = ["rewards", mint]        (Echo claimable rewards)
//!   epoch         = ["epoch", mint, epoch_index]
//!   claim         = ["claim", epoch, wallet] (existence == claimed; prevents double claims)
//!   treasury      = ["treasury", mint]       (Orbit)
//!   execution     = ["exec", mint, seq]      (UNIQUE seq prevents duplicate execution)
//!   protocol      = ["protocol"]             (governed parameters: fee bps, bounds)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

declare_id!("FATE1111111111111111111111111111111111111111");

pub const BPS: u64 = 10_000;
pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000; // 1B * 10^6
pub const CURVE_TOKENS: u64 = 793_100_000_000_000;
pub const RESERVED_TOKENS: u64 = 206_900_000_000_000;
pub const INITIAL_VIRTUAL_SOL: u64 = 30_000_000_000;
pub const INITIAL_VIRTUAL_TOKENS: u64 = 1_073_000_000_000_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Destiny { Phoenix, Gravity, Echo, Orbit }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExecState { Idle, Accumulating, Eligible, Executing, Completed, Failed }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status { Curve, Graduating, Amm }

/// Immutable after `launch`. There is deliberately no instruction that writes to it.
#[account]
pub struct Launch {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub destiny: Destiny,
    pub trade_fee_bps: u16,
    pub destiny_share_bps: u16,
    pub execution_threshold: u64,
    pub cooldown_slots: u64,
    pub max_slippage_bps: u16,
    pub graduation_threshold: u64,
    pub echo_min_balance: u64,
    pub echo_epoch_slots: u64,
    pub orbit_allocation_bps: [u16; 4], // SOL, USDC, LST, RESERVE
    pub config_hash: [u8; 32],
    pub bump: u8,
}

#[account]
pub struct Curve {
    pub mint: Pubkey,
    pub virtual_sol: u64,
    pub virtual_tokens: u64,
    pub real_sol: u64,
    pub real_tokens: u64,
    pub reserved_tokens: u64,
    pub status: Status,
    pub bump: u8,
}

#[account]
pub struct DestinyState {
    pub mint: Pubkey,
    pub state: ExecState,
    pub executions: u64,
    pub next_seq: u64,
    pub last_execution_slot: u64,
    pub lifetime_fees: u64,
    pub total_burned: u64,
    pub total_liquidity_added: u64,
    pub total_rewards_distributed: u64,
    pub total_treasury_deployed: u64,
    pub bump: u8,
}

#[account]
pub struct Execution {
    pub mint: Pubkey,
    pub seq: u64,
    pub completed: bool,
    pub failed: bool,
    pub vault_before: u64,
    pub amount_used: u64,
    pub slot: u64,
}

#[account]
pub struct RewardEpoch {
    pub mint: Pubkey,
    pub epoch: u64,
    pub funded: u64,
    pub claimed: u64,
    pub eligible_supply: u64,
    pub eligible_wallets: u32,
    pub min_balance: u64,
    /// Merkle root over (wallet, balance) pairs at the snapshot slot. Claims
    /// supply a proof; the snapshot itself is produced by the indexer from
    /// token-account state at `snapshot_slot` and is verifiable by anyone.
    pub merkle_root: [u8; 32],
    pub snapshot_slot: u64,
}

#[account]
pub struct Claim { pub epoch: Pubkey, pub wallet: Pubkey, pub amount: u64 }

#[account]
pub struct Protocol {
    pub authority: Pubkey, // governance; may change fee bps / bounds, never a launched token's destiny
    pub trade_fee_bps: u16,
    pub destiny_share_bps: u16,
    pub treasury: Pubkey,
    pub bump: u8,
}

#[error_code]
pub enum FateError {
    #[msg("arithmetic overflow")] Overflow,
    #[msg("amount must be positive")] BadAmount,
    #[msg("output below minimum: slippage exceeded")] Slippage,
    #[msg("curve inventory exhausted")] InsufficientInventory,
    #[msg("curve reserves cannot cover this sale")] InsufficientReserves,
    #[msg("destiny parameters out of protocol bounds")] BadParams,
    #[msg("destiny not eligible for execution")] NotEligible,
    #[msg("execution cooldown active")] Cooldown,
    #[msg("execution already in progress")] AlreadyExecuting,
    #[msg("wrong destiny for this instruction")] WrongDestiny,
    #[msg("wrong mint for this account")] MintMismatch,
    #[msg("already graduated")] AlreadyGraduated,
    #[msg("graduation threshold not reached")] NotGraduated,
    #[msg("rewards already claimed for this epoch")] AlreadyClaimed,
    #[msg("claims would exceed funded rewards")] Overclaim,
    #[msg("invalid merkle proof")] BadProof,
    #[msg("asset not on the approved list")] AssetNotApproved,
}

#[event] pub struct FeeDeposited { pub mint: Pubkey, pub destiny_fee: u64, pub protocol_fee: u64 }
#[event] pub struct Traded { pub mint: Pubkey, pub trader: Pubkey, pub is_buy: bool, pub sol: u64, pub tokens: u64, pub fee: u64 }
#[event] pub struct DestinyExecuted { pub mint: Pubkey, pub seq: u64, pub destiny: Destiny, pub amount_used: u64 }
#[event] pub struct Graduated { pub mint: Pubkey, pub sol_migrated: u64, pub tokens_migrated: u64 }

/// Pure curve math shared by buy / sell / quotes. Identical to src/engine/curve.ts.
pub mod math {
    use super::*;
    pub fn buy_out(v_sol: u64, v_tok: u64, net_in: u64) -> Result<(u64, u64, u64)> {
        let k = (v_sol as u128).checked_mul(v_tok as u128).ok_or(FateError::Overflow)?;
        let new_v_sol = v_sol.checked_add(net_in).ok_or(FateError::Overflow)?;
        let mut new_v_tok = (k / new_v_sol as u128) as u64;
        if k % new_v_sol as u128 != 0 { new_v_tok = new_v_tok.checked_add(1).ok_or(FateError::Overflow)?; }
        let out = v_tok.checked_sub(new_v_tok).ok_or(FateError::BadAmount)?;
        Ok((out, new_v_sol, new_v_tok))
    }
    pub fn sell_out(v_sol: u64, v_tok: u64, tok_in: u64) -> Result<(u64, u64, u64)> {
        let k = (v_sol as u128).checked_mul(v_tok as u128).ok_or(FateError::Overflow)?;
        let new_v_tok = v_tok.checked_add(tok_in).ok_or(FateError::Overflow)?;
        let mut new_v_sol = (k / new_v_tok as u128) as u64;
        if k % new_v_tok as u128 != 0 { new_v_sol = new_v_sol.checked_add(1).ok_or(FateError::Overflow)?; }
        let out = v_sol.checked_sub(new_v_sol).ok_or(FateError::BadAmount)?;
        Ok((out, new_v_sol, new_v_tok))
    }
    pub fn bps_of(x: u64, bps: u16) -> Result<u64> {
        Ok(((x as u128) * (bps as u128) / BPS as u128) as u64)
    }
}

#[program]
pub mod fate {
    use super::*;

    /// Create mint (supply minted once to the curve + reserve, then mint/freeze authority revoked),
    /// curve, vault, destiny state and the immutable Launch record.
    pub fn launch(ctx: Context<LaunchCtx>, args: LaunchArgs) -> Result<()> {
        let p = &ctx.accounts.protocol;
        require!(args.execution_threshold >= 250_000_000 && args.execution_threshold <= 50_000_000_000, FateError::BadParams);
        require!(args.graduation_threshold >= 5_000_000_000 && args.graduation_threshold <= 300_000_000_000, FateError::BadParams);
        require!(args.max_slippage_bps >= 50 && args.max_slippage_bps <= 1_500, FateError::BadParams);
        if args.destiny == Destiny::Orbit {
            let sum: u32 = args.orbit_allocation_bps.iter().map(|x| *x as u32).sum();
            require!(sum == BPS as u32, FateError::BadParams);
        }
        let l = &mut ctx.accounts.launch;
        l.mint = ctx.accounts.mint.key();
        l.creator = ctx.accounts.creator.key();
        l.destiny = args.destiny;
        l.trade_fee_bps = p.trade_fee_bps;
        l.destiny_share_bps = p.destiny_share_bps;
        l.execution_threshold = args.execution_threshold;
        l.cooldown_slots = args.cooldown_slots;
        l.max_slippage_bps = args.max_slippage_bps;
        l.graduation_threshold = args.graduation_threshold;
        l.echo_min_balance = args.echo_min_balance;
        l.echo_epoch_slots = args.echo_epoch_slots;
        l.orbit_allocation_bps = args.orbit_allocation_bps;
        l.config_hash = args.config_hash;
        l.bump = ctx.bumps.launch;

        let c = &mut ctx.accounts.curve;
        c.mint = l.mint;
        c.virtual_sol = INITIAL_VIRTUAL_SOL;
        c.virtual_tokens = INITIAL_VIRTUAL_TOKENS;
        c.real_sol = 0;
        c.real_tokens = CURVE_TOKENS;
        c.reserved_tokens = RESERVED_TOKENS;
        c.status = Status::Curve;
        c.bump = ctx.bumps.curve;

        let s = &mut ctx.accounts.destiny_state;
        s.mint = l.mint;
        s.state = ExecState::Idle;
        s.bump = ctx.bumps.destiny_state;

        // mint full supply to curve token account + reserve, then revoke authorities
        let seeds: &[&[u8]] = &[b"curve", l.mint.as_ref(), &[c.bump]];
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), token::MintTo {
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.curve_tokens.to_account_info(), authority: ctx.accounts.curve.to_account_info() }, &[seeds]), CURVE_TOKENS)?;
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), token::MintTo {
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.reserve_tokens.to_account_info(), authority: ctx.accounts.curve.to_account_info() }, &[seeds]), RESERVED_TOKENS)?;
        token::set_authority(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), token::SetAuthority {
            current_authority: ctx.accounts.curve.to_account_info(), account_or_mint: ctx.accounts.mint.to_account_info() }, &[seeds]),
            token::spl_token::instruction::AuthorityType::MintTokens, None)?;
        Ok(())
    }

    /// Buy on the curve. Fee is split into the destiny vault and the protocol treasury.
    pub fn buy(ctx: Context<Trade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_in > 0, FateError::BadAmount);
        let l = &ctx.accounts.launch;
        let c = &mut ctx.accounts.curve;
        require!(c.status == Status::Curve, FateError::AlreadyGraduated);
        let fee = math::bps_of(sol_in, l.trade_fee_bps)?;
        let net = sol_in.checked_sub(fee).ok_or(FateError::Overflow)?;
        let (out, nv_sol, nv_tok) = math::buy_out(c.virtual_sol, c.virtual_tokens, net)?;
        require!(out >= min_tokens_out, FateError::Slippage);
        require!(out <= c.real_tokens, FateError::InsufficientInventory);
        let destiny_fee = math::bps_of(fee, l.destiny_share_bps)?;
        let protocol_fee = fee - destiny_fee;
        // SOL: trader -> curve (net), -> vault (destiny_fee), -> treasury (protocol_fee)
        transfer_lamports(&ctx.accounts.trader, &ctx.accounts.curve.to_account_info(), net, &ctx.accounts.system_program)?;
        transfer_lamports(&ctx.accounts.trader, &ctx.accounts.vault, destiny_fee, &ctx.accounts.system_program)?;
        transfer_lamports(&ctx.accounts.trader, &ctx.accounts.protocol_treasury, protocol_fee, &ctx.accounts.system_program)?;
        // tokens: curve -> trader
        let seeds: &[&[u8]] = &[b"curve", c.mint.as_ref(), &[c.bump]];
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.curve_tokens.to_account_info(), to: ctx.accounts.trader_tokens.to_account_info(), authority: ctx.accounts.curve.to_account_info() }, &[seeds]), out)?;
        c.virtual_sol = nv_sol; c.virtual_tokens = nv_tok;
        c.real_sol = c.real_sol.checked_add(net).ok_or(FateError::Overflow)?;
        c.real_tokens -= out;
        let s = &mut ctx.accounts.destiny_state;
        s.lifetime_fees = s.lifetime_fees.checked_add(destiny_fee).ok_or(FateError::Overflow)?;
        if s.state == ExecState::Idle { s.state = ExecState::Accumulating; }
        emit!(Traded { mint: c.mint, trader: ctx.accounts.trader.key(), is_buy: true, sol: sol_in, tokens: out, fee });
        emit!(FeeDeposited { mint: c.mint, destiny_fee, protocol_fee });
        Ok(())
    }

    pub fn sell(ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        require!(tokens_in > 0, FateError::BadAmount);
        let l = &ctx.accounts.launch;
        let c = &mut ctx.accounts.curve;
        require!(c.status == Status::Curve, FateError::AlreadyGraduated);
        let (gross, nv_sol, nv_tok) = math::sell_out(c.virtual_sol, c.virtual_tokens, tokens_in)?;
        require!(gross <= c.real_sol, FateError::InsufficientReserves);
        let fee = math::bps_of(gross, l.trade_fee_bps)?;
        let out = gross - fee;
        require!(out >= min_sol_out, FateError::Slippage);
        let destiny_fee = math::bps_of(fee, l.destiny_share_bps)?;
        let protocol_fee = fee - destiny_fee;
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.trader_tokens.to_account_info(), to: ctx.accounts.curve_tokens.to_account_info(), authority: ctx.accounts.trader.to_account_info() }), tokens_in)?;
        // SOL out of the curve PDA (owned by this program): direct lamport moves
        sub_lamports(&ctx.accounts.curve.to_account_info(), gross)?;
        add_lamports(&ctx.accounts.trader.to_account_info(), out)?;
        add_lamports(&ctx.accounts.vault, destiny_fee)?;
        add_lamports(&ctx.accounts.protocol_treasury, protocol_fee)?;
        c.virtual_sol = nv_sol; c.virtual_tokens = nv_tok;
        c.real_sol -= gross; c.real_tokens = c.real_tokens.checked_add(tokens_in).ok_or(FateError::Overflow)?;
        let s = &mut ctx.accounts.destiny_state;
        s.lifetime_fees = s.lifetime_fees.checked_add(destiny_fee).ok_or(FateError::Overflow)?;
        emit!(Traded { mint: c.mint, trader: ctx.accounts.trader.key(), is_buy: false, sol: gross, tokens: tokens_in, fee });
        emit!(FeeDeposited { mint: c.mint, destiny_fee, protocol_fee });
        Ok(())
    }

    /// Permissionless. Opens an execution slot if, and only if, the program's own
    /// eligibility check passes. Creating the `Execution` PDA at ["exec", mint, seq]
    /// makes duplicate execution impossible.
    pub fn begin_execution(ctx: Context<BeginExecution>) -> Result<()> {
        let l = &ctx.accounts.launch;
        let s = &mut ctx.accounts.destiny_state;
        require!(s.state != ExecState::Executing, FateError::AlreadyExecuting);
        let vault = ctx.accounts.vault.lamports();
        require!(vault >= l.execution_threshold, FateError::NotEligible);
        let slot = Clock::get()?.slot;
        require!(slot >= s.last_execution_slot.saturating_add(l.cooldown_slots), FateError::Cooldown);
        let e = &mut ctx.accounts.execution;
        e.mint = l.mint; e.seq = s.next_seq; e.vault_before = vault; e.slot = slot;
        s.next_seq += 1;
        s.state = ExecState::Executing;
        Ok(())
    }

    /// PHOENIX: buy with vault SOL on the curve (bounded by max_slippage_bps) and burn.
    pub fn execute_phoenix(ctx: Context<ExecutePhoenix>, amount: u64, min_tokens_out: u64) -> Result<()> {
        let l = &ctx.accounts.launch;
        require!(l.destiny == Destiny::Phoenix, FateError::WrongDestiny);
        require!(amount <= ctx.accounts.vault.lamports(), FateError::BadAmount);
        let c = &mut ctx.accounts.curve;
        let fee = math::bps_of(amount, l.trade_fee_bps)?;
        let net = amount - fee;
        let spot_before = c.virtual_sol as u128 * 1_000_000 / c.virtual_tokens as u128;
        let (out, nv_sol, nv_tok) = math::buy_out(c.virtual_sol, c.virtual_tokens, net)?;
        let spot_after = nv_sol as u128 * 1_000_000 / nv_tok as u128;
        let impact_bps = (spot_after - spot_before) * BPS as u128 / spot_before;
        require!(impact_bps <= l.max_slippage_bps as u128, FateError::Slippage);
        require!(out >= min_tokens_out && out <= c.real_tokens, FateError::Slippage);
        // move SOL from vault PDA to curve + fee split (fee re-enters vault/treasury)
        sub_lamports(&ctx.accounts.vault, amount)?;
        add_lamports(&ctx.accounts.curve.to_account_info(), net)?;
        add_lamports(&ctx.accounts.vault, math::bps_of(fee, l.destiny_share_bps)?)?;
        add_lamports(&ctx.accounts.protocol_treasury, fee - math::bps_of(fee, l.destiny_share_bps)?)?;
        // burn straight from the curve's token account: tokens never sit anywhere spendable
        let seeds: &[&[u8]] = &[b"curve", c.mint.as_ref(), &[c.bump]];
        token::burn(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Burn {
            mint: ctx.accounts.mint.to_account_info(), from: ctx.accounts.curve_tokens.to_account_info(), authority: ctx.accounts.curve.to_account_info() }, &[seeds]), out)?;
        c.virtual_sol = nv_sol; c.virtual_tokens = nv_tok; c.real_sol += net; c.real_tokens -= out;
        finish(&mut ctx.accounts.destiny_state, &mut ctx.accounts.execution, amount)?;
        ctx.accounts.destiny_state.total_burned += out;
        emit!(DestinyExecuted { mint: c.mint, seq: ctx.accounts.execution.seq, destiny: Destiny::Phoenix, amount_used: amount });
        Ok(())
    }

    // execute_gravity, settle_echo_epoch, claim_echo, execute_orbit and graduate follow the
    // same begin/finish pattern. Their account constraints are declared below; bodies are
    // left for the devnet milestone because they require venue CPIs (Raydium CPMM for
    // liquidity and pool creation; Jupiter for Orbit swaps) whose interfaces must be
    // confirmed against the live programs before being written. See README.

    pub fn claim_echo(ctx: Context<ClaimEcho>, amount: u64, balance: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        let e = &mut ctx.accounts.epoch;
        let leaf = anchor_lang::solana_program::keccak::hashv(&[ctx.accounts.wallet.key().as_ref(), &balance.to_le_bytes()]).0;
        require!(verify_proof(&proof, e.merkle_root, leaf), FateError::BadProof);
        let expected = (e.funded as u128 * balance as u128 / e.eligible_supply as u128) as u64;
        require!(amount == expected, FateError::BadAmount);
        require!(e.claimed.checked_add(amount).ok_or(FateError::Overflow)? <= e.funded, FateError::Overclaim);
        sub_lamports(&ctx.accounts.rewards, amount)?;
        add_lamports(&ctx.accounts.wallet.to_account_info(), amount)?;
        e.claimed += amount;
        let c = &mut ctx.accounts.claim; // init => fails if it already exists: double-claim prevention
        c.epoch = e.key(); c.wallet = ctx.accounts.wallet.key(); c.amount = amount;
        Ok(())
    }
}

fn finish(s: &mut Account<DestinyState>, e: &mut Account<Execution>, amount_used: u64) -> Result<()> {
    e.completed = true; e.amount_used = amount_used;
    s.executions += 1; s.last_execution_slot = Clock::get()?.slot; s.state = ExecState::Completed;
    Ok(())
}
fn verify_proof(proof: &[[u8; 32]], root: [u8; 32], leaf: [u8; 32]) -> bool {
    let mut h = leaf;
    for p in proof {
        h = if h <= *p { anchor_lang::solana_program::keccak::hashv(&[&h, p]).0 } else { anchor_lang::solana_program::keccak::hashv(&[p, &h]).0 };
    }
    h == root
}
fn transfer_lamports<'a>(from: &Signer<'a>, to: &AccountInfo<'a>, lamports: u64, sys: &Program<'a, System>) -> Result<()> {
    if lamports == 0 { return Ok(()); }
    anchor_lang::system_program::transfer(CpiContext::new(sys.to_account_info(), anchor_lang::system_program::Transfer { from: from.to_account_info(), to: to.clone() }), lamports)
}
fn sub_lamports(a: &AccountInfo, l: u64) -> Result<()> { **a.try_borrow_mut_lamports()? = a.lamports().checked_sub(l).ok_or(FateError::Overflow)?; Ok(()) }
fn add_lamports(a: &AccountInfo, l: u64) -> Result<()> { **a.try_borrow_mut_lamports()? = a.lamports().checked_add(l).ok_or(FateError::Overflow)?; Ok(()) }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LaunchArgs {
    pub destiny: Destiny,
    pub execution_threshold: u64,
    pub cooldown_slots: u64,
    pub max_slippage_bps: u16,
    pub graduation_threshold: u64,
    pub echo_min_balance: u64,
    pub echo_epoch_slots: u64,
    pub orbit_allocation_bps: [u16; 4],
    pub config_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct LaunchCtx<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    #[account(seeds = [b"protocol"], bump = protocol.bump)] pub protocol: Account<'info, Protocol>,
    #[account(init, payer = creator, mint::decimals = 6, mint::authority = curve)] pub mint: Account<'info, Mint>,
    #[account(init, payer = creator, space = 8 + 256, seeds = [b"launch", mint.key().as_ref()], bump)] pub launch: Account<'info, Launch>,
    #[account(init, payer = creator, space = 8 + 128, seeds = [b"curve", mint.key().as_ref()], bump)] pub curve: Account<'info, Curve>,
    #[account(init, payer = creator, space = 8 + 128, seeds = [b"state", mint.key().as_ref()], bump)] pub destiny_state: Account<'info, DestinyState>,
    /// CHECK: SOL vault PDA, owned by this program
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump)] pub vault: AccountInfo<'info>,
    #[account(init, payer = creator, token::mint = mint, token::authority = curve, seeds = [b"curve_tokens", mint.key().as_ref()], bump)] pub curve_tokens: Account<'info, TokenAccount>,
    #[account(init, payer = creator, token::mint = mint, token::authority = curve, seeds = [b"reserve_tokens", mint.key().as_ref()], bump)] pub reserve_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)] pub trader: Signer<'info>,
    #[account(seeds = [b"launch", curve.mint.as_ref()], bump = launch.bump, constraint = launch.mint == curve.mint @ FateError::MintMismatch)] pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [b"curve", curve.mint.as_ref()], bump = curve.bump)] pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"state", curve.mint.as_ref()], bump = destiny_state.bump)] pub destiny_state: Account<'info, DestinyState>,
    /// CHECK: vault PDA validated by seeds
    #[account(mut, seeds = [b"vault", curve.mint.as_ref()], bump)] pub vault: AccountInfo<'info>,
    /// CHECK: protocol treasury, validated against Protocol account
    #[account(mut, address = protocol.treasury)] pub protocol_treasury: AccountInfo<'info>,
    #[account(seeds = [b"protocol"], bump = protocol.bump)] pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [b"curve_tokens", curve.mint.as_ref()], bump, token::mint = curve.mint)] pub curve_tokens: Account<'info, TokenAccount>,
    #[account(mut, token::mint = curve.mint, token::authority = trader)] pub trader_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BeginExecution<'info> {
    #[account(mut)] pub cranker: Signer<'info>,
    #[account(seeds = [b"launch", launch.mint.as_ref()], bump = launch.bump)] pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [b"state", launch.mint.as_ref()], bump = destiny_state.bump)] pub destiny_state: Account<'info, DestinyState>,
    /// CHECK: vault PDA
    #[account(seeds = [b"vault", launch.mint.as_ref()], bump)] pub vault: AccountInfo<'info>,
    #[account(init, payer = cranker, space = 8 + 96, seeds = [b"exec", launch.mint.as_ref(), &destiny_state.next_seq.to_le_bytes()], bump)] pub execution: Account<'info, Execution>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecutePhoenix<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [b"launch", curve.mint.as_ref()], bump = launch.bump)] pub launch: Account<'info, Launch>,
    #[account(mut, seeds = [b"curve", curve.mint.as_ref()], bump = curve.bump)] pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"state", curve.mint.as_ref()], bump = destiny_state.bump, constraint = destiny_state.state == ExecState::Executing @ FateError::NotEligible)] pub destiny_state: Account<'info, DestinyState>,
    #[account(mut, constraint = execution.mint == curve.mint && !execution.completed && !execution.failed)] pub execution: Account<'info, Execution>,
    /// CHECK: vault PDA
    #[account(mut, seeds = [b"vault", curve.mint.as_ref()], bump)] pub vault: AccountInfo<'info>,
    /// CHECK: protocol treasury
    #[account(mut, address = protocol.treasury)] pub protocol_treasury: AccountInfo<'info>,
    #[account(seeds = [b"protocol"], bump = protocol.bump)] pub protocol: Account<'info, Protocol>,
    #[account(mut, address = curve.mint)] pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"curve_tokens", curve.mint.as_ref()], bump)] pub curve_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimEcho<'info> {
    #[account(mut)] pub wallet: Signer<'info>,
    #[account(mut, constraint = epoch.mint == launch.mint)] pub epoch: Account<'info, RewardEpoch>,
    #[account(seeds = [b"launch", launch.mint.as_ref()], bump = launch.bump, constraint = launch.destiny == Destiny::Echo @ FateError::WrongDestiny)] pub launch: Account<'info, Launch>,
    /// CHECK: rewards PDA
    #[account(mut, seeds = [b"rewards", launch.mint.as_ref()], bump)] pub rewards: AccountInfo<'info>,
    #[account(init, payer = wallet, space = 8 + 80, seeds = [b"claim", epoch.key().as_ref(), wallet.key().as_ref()], bump)] pub claim: Account<'info, Claim>,
    pub system_program: Program<'info, System>,
}
