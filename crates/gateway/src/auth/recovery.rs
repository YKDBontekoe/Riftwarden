//! One-time recovery codes: 16 Crockford base32 characters shown once (XXXX-XXXX-XXXX-XXXX), stored as Argon2id.

use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A fresh code in display form.
pub fn generate() -> String {
    let mut bytes = [0u8; 16];
    rand::fill(&mut bytes);
    let chars: Vec<char> = bytes.iter().map(|b| ALPHABET[(b & 31) as usize] as char).collect();
    chars.chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

/// Canonical form of user input: upper case, no separators, Crockford look-alikes mapped (O->0, I/L->1).
pub fn canonical(input: &str) -> String {
    input
        .chars()
        .filter(|c| !matches!(c, '-' | ' '))
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            u => u,
        })
        .collect()
}

pub fn hash(code: &str) -> Result<String, String> {
    Argon2::default().hash_password(canonical(code).as_bytes()).map(|h| h.to_string()).map_err(|e| e.to_string())
}

pub fn verify(code: &str, stored: &str) -> bool {
    let canon = canonical(code);
    if canon.len() != 16 {
        return false;
    }
    PasswordHash::new(stored).is_ok_and(|h| Argon2::default().verify_password(canon.as_bytes(), &h).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_lookalikes() {
        let code = generate();
        assert_eq!(code.len(), 19);
        let h = hash(&code).unwrap();
        assert!(verify(&code, &h));
        assert!(verify(&code.to_lowercase().replace('-', " "), &h));
        assert!(!verify("0000-0000-0000-0000", &h));
        assert_eq!(canonical("abcd-oil0"), "ABCD0110");
        assert_ne!(generate(), generate());
    }
}
