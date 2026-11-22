use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("stake must be one of the tiers: 0, 0.05, 0.1 or 0.25 SOL")]
    BadStake,
    #[msg("the match is not in the right state for this")]
    WrongStatus,
    #[msg("signer is not a player of this match")]
    NotAPlayer,
    #[msg("burner key is missing or already used by the other side")]
    BadBurner,
    #[msg("account does not belong to this match")]
    WrongAccount,
    #[msg("too early to cancel or abort")]
    TooEarly,
    #[msg("the rig was refused (used this stage, opponent dead, done or past your stage, revealed or a bad slot)")]
    RigRefused,
    #[msg(
        "the peek was refused (not your fight or raid, used this stage, revealed or a bad slot)"
    )]
    PeekRefused,
    #[msg("the match has no result yet")]
    NotOver,
    #[msg("already settled")]
    AlreadySettled,
    #[msg("wrong payout recipient")]
    WrongRecipient,
    #[msg("only the TEE validator may host a match")]
    WrongValidator,
    #[msg("bad account data")]
    BadData,
}
