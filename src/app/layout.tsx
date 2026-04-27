import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEV FC Planner",
  description: "Team balancer and lineup planner for DEV FC.",
};

const dotQueryPatch = `
(() => {
  const originalIncludes = String.prototype.includes;
  const originalSlice = Array.prototype.slice;

  function isPlayerSearchDotMode() {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.some((input) => input.value.trim() === '.');
  }

  function looksLikePlayerArray(items) {
    return Array.isArray(items) && items.length > 0 && items.every((item) =>
      item && typeof item === 'object' &&
      typeof item.name === 'string' &&
      typeof item.primaryPosition === 'string'
    );
  }

  String.prototype.includes = function(search, ...args) {
    if (search === '.' && isPlayerSearchDotMode()) return true;
    return originalIncludes.call(this, search, ...args);
  };

  Array.prototype.slice = function(start, end, ...args) {
    if (start === 0 && end === 20 && isPlayerSearchDotMode() && looksLikePlayerArray(this)) {
      return originalSlice.call(this, 0, this.length);
    }
    return originalSlice.call(this, start, end, ...args);
  };
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <script dangerouslySetInnerHTML={{ __html: dotQueryPatch }} />
        {children}
      </body>
    </html>
  );
}
