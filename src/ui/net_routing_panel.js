export function renderNetRoutingPanel(enabled) {
  return `<section class="connection-section">
    <h3>Net routing</h3>
    <label class="alias-toggle"><input type="checkbox" data-route-net${enabled ? " checked" : ""}><span>Route net / 布线</span></label>
    <p class="hierarchy-connection-note">取消勾选后不布线，保留单元、引脚和连接信息；assign 别名同步生效。重新勾选可恢复。</p>
  </section>`;
}

export function bindNetRoutingPanel(container, onChange) {
  container.querySelector("[data-route-net]")?.addEventListener("change", (event) => {
    onChange(event.target.checked);
  });
}
