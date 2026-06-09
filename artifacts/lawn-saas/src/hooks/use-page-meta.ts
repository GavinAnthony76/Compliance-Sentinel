import { useEffect } from "react";

const SITE_NAME = "GreenSynk";
const DEFAULT_DESCRIPTION =
  "GreenSynk helps lawn care businesses manage scheduling, routing, invoicing, estimates, and customer communication from one platform.";
const DEFAULT_IMAGE = "https://greensynk.com/opengraph.jpg";

interface PageMetaOptions {
  title: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
}

function setMeta(property: string, content: string, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function usePageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  image = DEFAULT_IMAGE,
  noIndex = false,
}: PageMetaOptions) {
  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME)
      ? title
      : `${title} — ${SITE_NAME}`;

    document.title = fullTitle;

    setMeta("description", description);

    setMeta("og:title", fullTitle, true);
    setMeta("og:description", description, true);
    setMeta("og:image", image, true);
    setMeta("og:site_name", SITE_NAME, true);

    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", description);
    setMeta("twitter:image", image);

    if (noIndex) {
      setMeta("robots", "noindex, nofollow");
    } else {
      const robots = document.querySelector('meta[name="robots"]');
      if (robots) robots.setAttribute("content", "index, follow");
    }
  }, [title, description, image, noIndex]);
}
