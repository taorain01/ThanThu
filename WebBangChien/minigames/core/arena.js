export function showLobbyView() {
  document.getElementById("arena-view")?.style.setProperty("display", "none");
  document.getElementById("lobby-view")?.style.setProperty("display", "flex");
}

export function showArenaView() {
  document.getElementById("lobby-view")?.style.setProperty("display", "none");
  document.getElementById("arena-view")?.style.setProperty("display", "flex");
}

export function setArenaTitle(title) {
  const logo = document.querySelector(".arena-logo");
  if (logo) logo.textContent = title;
}

export function setCommentaryText(text) {
  const commentary = document.getElementById("commentary-text");
  if (commentary) commentary.textContent = text;
}
