export function getBoardReturnUrl(
  returnUrl: string | string[] | undefined,
  boardUrl: string,
  otherBoardUrls: string[] = [],
) {
  if (
    typeof returnUrl !== "string" ||
    !returnUrl.startsWith("/") ||
    returnUrl.startsWith("//")
  ) {
    return boardUrl;
  }

  try {
    const url = new URL(returnUrl, "http://localhost");
    if (
      url.origin !== "http://localhost" ||
      (url.pathname !== boardUrl && !otherBoardUrls.includes(url.pathname))
    ) {
      return boardUrl;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return boardUrl;
  }
}
