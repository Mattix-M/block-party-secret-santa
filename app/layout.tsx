import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Block Party | Secret Santa",
  description: "The BLOCK PARTY Secret Santa exchange in Richmond, Virginia.",
  robots: { index: false, follow: false },
  icons: { icon: "/party-icon.png" },
};
export const viewport: Viewport = { themeColor: "#f7f2e7", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
