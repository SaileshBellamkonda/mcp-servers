const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isOctet(part: string | undefined): boolean {
  return part !== undefined && Number(part) <= 255;
}

/**
 * True for hosts that only accept connections from the local machine:
 * `127.0.0.0/8`, `localhost`, `::1` and `[::1]`. Wildcard addresses
 * (`0.0.0.0`, `::`) and every other address or hostname are not loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const normalised = host.trim().toLowerCase();
  if (normalised === 'localhost' || normalised === '::1' || normalised === '[::1]') return true;
  const match = IPV4_LOOPBACK.exec(normalised);
  return match?.slice(1).every(isOctet) ?? false;
}
