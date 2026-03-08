export async function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nSitemap: https://sum.money/sitemap-index.xml`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
}
