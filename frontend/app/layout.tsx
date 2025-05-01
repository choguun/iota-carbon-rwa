import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { cn } from "@/lib/utils";
import { Web3Provider } from "@/components/providers/Web3Provider";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Verifiable Carbon Offset Marketplace",
  description: "Trade and retire verifiable carbon credits on the IOTA blockchain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body 
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          inter.className
        )}
      >
        <Web3Provider>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-grow container mx-auto px-4 md:px-6 py-8">
              {children}
            </main>
            <Footer />
          </div>
          <Toaster richColors />
        </Web3Provider>
      </body>
    </html>
  );
}
