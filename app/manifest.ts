import type { MetadataRoute } from "next";
import { appPath, BASE_PATH } from "@/lib/base-path";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "协策达",
    short_name: "协策达",
    description: "Collaborative project planning, progress, and delivery",
    start_url: BASE_PATH || "/",
    scope: BASE_PATH || "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f7f3",
    theme_color: "#064e3b",
    categories: ["business", "productivity"],
    icons: [
      {
        src: appPath("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: appPath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: appPath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
