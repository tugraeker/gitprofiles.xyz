use napi_derive::napi;
use serde_json::Value;

#[napi(js_name = "validateProfileJson")]
pub fn validate_profile_json(profile_json: String) -> bool {
    if profile_json.len() > 500_000 {
        return false;
    }

    let Ok(profile) = serde_json::from_str::<Value>(&profile_json) else {
        return false;
    };

    let Some(username) = profile.get("username").and_then(Value::as_str) else {
        return false;
    };
    let Some(name) = profile.get("name").and_then(Value::as_str) else {
        return false;
    };
    let Some(links) = profile.get("links").and_then(Value::as_array) else {
        return false;
    };

    !username.trim().is_empty()
        && !name.trim().is_empty()
        && links.len() <= 12
        && links.iter().all(|link| {
            let title = link.get("title").and_then(Value::as_str);
            let url = link.get("url").and_then(Value::as_str);
            matches!((title, url), (Some(_), Some(url)) if url.starts_with("https://") || url.starts_with("http://"))
        })
}

#[cfg(test)]
mod tests {
    use super::validate_profile_json;

    #[test]
    fn validates_profile_and_rejects_invalid_urls() {
        let valid = r#"{"username":"mira","name":"Mira","links":[{"title":"Site","url":"https://example.com"}]}"#;
        let invalid = r#"{"username":"mira","name":"Mira","links":[{"title":"Site","url":"javascript:alert(1)"}]}"#;
        assert!(validate_profile_json(valid.to_string()));
        assert!(!validate_profile_json(invalid.to_string()));
    }

    #[test]
    fn rejects_malformed_or_oversized_profile_data() {
        assert!(!validate_profile_json("not json".to_string()));
        assert!(!validate_profile_json("x".repeat(500_001)));
    }
}
