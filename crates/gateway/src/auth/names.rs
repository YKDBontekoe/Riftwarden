//! Display names: unique (case-insensitive), 3-18 characters of letters, digits, space, `_`, `.`, `-`.

pub fn normalize(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Ok(name) when valid, Err(reason) otherwise.
pub fn validate(raw: &str) -> Result<String, &'static str> {
    let name = normalize(raw);
    let len = name.chars().count();
    if len < 3 {
        return Err("Names need at least 3 characters");
    }
    if len > 18 {
        return Err("Names can have at most 18 characters");
    }
    if !name.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '.' | '-')) {
        return Err("Use letters, digits, spaces, _ . or -");
    }
    if !name.chars().any(|c| c.is_alphanumeric()) {
        return Err("Names need a letter or digit");
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(validate("  Rift   Warden "), Ok("Rift Warden".into()));
        assert_eq!(validate("Ålva_9"), Ok("Ålva_9".into()));
        assert!(validate("ab").is_err());
        assert!(validate("a".repeat(19).as_str()).is_err());
        assert!(validate("bad<name>").is_err());
        assert!(validate("___").is_err());
    }
}
