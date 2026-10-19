// THE DEVICE: ten humans. Ten square cells with a 2 px rule. One turns solid per
// real YES from an outside wallet. Hollow means nobody yet. A project is live when
// the row is solid. The count on screen is always the server's count.
export function TenHumans({ yes, of = 10, big = false }: { yes: number; of?: number; big?: boolean }) {
  const cells = Array.from({ length: of }, (_, i) => i < yes);
  return (
    <div className={`fv-ten ${big ? "gap-[6px]" : ""}`} role="img" aria-label={`${Math.min(yes, of)} of ${of} said YES`}>
      {cells.map((on, i) => <span key={i} data-on={on ? "true" : "false"} data-pip={on ? "on" : "off"} />)}
    </div>
  );
}
