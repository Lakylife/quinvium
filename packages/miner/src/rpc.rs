//! Small HTTP client for the node's JSON-RPC: http:// for the own node, https:// for pool servers and public nodes (rustls).
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

pub struct Rpc {
    tls: bool,
    host: String,
    port: u16,
    path: String,
}

impl Rpc {
    pub fn new(url: &str) -> Result<Self, String> {
        let (tls, rest) = if let Some(r) = url.strip_prefix("https://") {
            (true, r)
        } else if let Some(r) = url.strip_prefix("http://") {
            (false, r)
        } else {
            return Err("the node address must start with http:// or https://".into());
        };
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], rest[i..].to_string()),
            None => (rest, "/".to_string()),
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().map_err(|_| "invalid node port")?),
            None => (authority.to_string(), if tls { 443 } else { 80 }),
        };
        Ok(Rpc { tls, host, port, path })
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).to_string();
        let addr = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("cannot resolve the node address")?;
        let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| e.to_string())?;
        s.set_read_timeout(Some(Duration::from_secs(30))).ok();
        s.set_nodelay(true).ok();
        let req = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.path, self.host, body.len(), body
        );
        let mut raw = Vec::new();
        if self.tls {
            let name = rustls::pki_types::ServerName::try_from(self.host.clone()).map_err(|e| e.to_string())?;
            let conn = rustls::ClientConnection::new(tls_config(), name).map_err(|e| e.to_string())?;
            let mut t = rustls::StreamOwned::new(conn, s);
            t.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
            // Some servers close without close_notify; what arrived before that is the whole answer.
            if let Err(e) = t.read_to_end(&mut raw) {
                if raw.is_empty() {
                    return Err(e.to_string());
                }
            }
        } else {
            s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
            s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
        }
        let text = String::from_utf8_lossy(&raw);
        let i = text.find("\r\n\r\n").ok_or("invalid node response")?;
        let head = text[..i].to_ascii_lowercase();
        let body = if head.contains("transfer-encoding: chunked") { dechunk(&text[i + 4..]) } else { text[i + 4..].to_string() };
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
            return Err(err.get("message").and_then(Value::as_str).unwrap_or("node error").to_string());
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }
}

/// One TLS configuration for the whole run: Mozilla roots, TLS 1.2 and 1.3, ring.
fn tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: std::sync::OnceLock<Arc<rustls::ClientConfig>> = std::sync::OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            Arc::new(
                rustls::ClientConfig::builder_with_provider(provider)
                    .with_safe_default_protocol_versions()
                    .expect("TLS versions")
                    .with_root_certificates(roots)
                    .with_no_client_auth(),
            )
        })
        .clone()
}

fn dechunk(mut s: &str) -> String {
    let mut out = String::new();
    while let Some(i) = s.find("\r\n") {
        let Ok(size) = usize::from_str_radix(s[..i].trim(), 16) else { break };
        if size == 0 || i + 2 + size > s.len() {
            break;
        }
        out.push_str(&s[i + 2..i + 2 + size]);
        s = s[i + 2 + size..].trim_start_matches("\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::Rpc;

    #[test]
    fn parses_http_and_https_addresses() {
        let a = Rpc::new("http://127.0.0.1:8545").unwrap();
        assert!(!a.tls && a.host == "127.0.0.1" && a.port == 8545 && a.path == "/");
        let b = Rpc::new("https://pool.quinvium.com").unwrap();
        assert!(b.tls && b.host == "pool.quinvium.com" && b.port == 443);
        let c = Rpc::new("https://pool.example.org:8443/rpc").unwrap();
        assert!(c.tls && c.port == 8443 && c.path == "/rpc");
        assert!(Rpc::new("ftp://x").is_err());
    }
}
