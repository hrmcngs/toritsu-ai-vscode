use axum::{response::Html, routing::get, Router};
use rand::seq::SliceRandom;
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/", get(index));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running at http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind address");

    axum::serve(listener, app)
        .await
        .expect("server error");
}

async fn index() -> Html<String> {
    let names = [
        "Yuki", "Haruto", "Sakura", "Ren", "Yuna", "Sota", "Aoi", "Hinata", "Mei",
        "Kaito",
    ];

    let name = names
        .choose(&mut rand::thread_rng())
        .copied()
        .unwrap_or("World");

    Html(format!(
        r#"<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rust Demo</title>
    <style>
      body {{
        font-family: sans-serif;
        display: grid;
        place-items: center;
        min-height: 100vh;
        margin: 0;
        background: #f7f7f7;
      }}
      main {{
        background: #fff;
        padding: 32px;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
        text-align: center;
      }}
      h1 {{
        margin: 0;
      }}
      p {{
        color: #666;
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>Hello {name}</h1>
      <p>ブラウザで再読み込みすると別の名前になることがあります。</p>
      <p>hello world</p>
    </main>
  </body>
</html>"#
    ))
}
