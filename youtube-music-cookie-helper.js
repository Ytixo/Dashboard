(() => {
  const cookie = document.cookie;
  const payload = {
    cookie,
    auth_user: "0",
    user_agent: navigator.userAgent,
    auth_headers: {
      cookie,
      "x-goog-authuser": "0",
      origin: "https://music.youtube.com",
      "x-origin": "https://music.youtube.com",
      "user-agent": navigator.userAgent
    }
  };

  const output = JSON.stringify(payload, null, 2);
  const done = () => console.log("Cookies YouTube Music copiés. Colle le JSON dans le dashboard.");
  const warn = () => console.warn("Aucun __Secure-3PAPISID visible dans document.cookie. Ouvre music.youtube.com avec ton compte connecté puis relance le script.");

  if (!/__Secure-3PAPISID=/.test(cookie)) {
    warn();
  }

  if (typeof copy === "function") {
    copy(output);
    done();
    return;
  }

  navigator.clipboard.writeText(output).then(done).catch(() => {
    console.log(output);
    console.log("Copie le JSON ci-dessus dans le dashboard.");
  });
})();
