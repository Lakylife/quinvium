//! Malý HTTP klient pro JSON-RPC uzlu. Bez závislostí na TLS: miner mluví s vlastním uzlem.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

pub struct Rpc {
    host: String,
    port: u16,
    path: String,
}

impl Rpc {
    pub fn new(url: &str) -> Result<Self, String> {
        let rest = url.strip_prefix("http://").ok_or("adresa uzlu musí začínat http://")?;
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], rest[i..].to_string()),
            None => (rest, "/".to_string()),
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().map_err(|_| "neplatný port uzlu")?),
            None => (authority.to_string(), 80),
        };
        Ok(Rpc { host, port, path })
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).to_string();
        let addr = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("nelze přeložit adresu uzlu")?;
        let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| e.to_string())?;
        s.set_read_timeout(Some(Duration::from_secs(30))).ok();
        s.set_nodelay(true).ok();
        let req = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.path, self.host, body.len(), body
        );
        s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&raw);
        let i = text.find("\r\n\r\n").ok_or("neplatná odpověď uzlu")?;
        let head = text[..i].to_ascii_lowercase();
        let body = if head.contains("transfer-encoding: chunked") { dechunk(&text[i + 4..]) } else { text[i + 4..].to_string() };
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
            return Err(err.get("message").and_then(Value::as_str).unwrap_or("chyba uzlu").to_string());
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }
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
