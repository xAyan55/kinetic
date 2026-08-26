/**
 * Activity Tab Controller
 * Server-specific audit logs and event timeline.
 */
const ActivityTabController = {
  serverId: null,

  mount(serverId) {
    this.serverId = serverId;
    this.loadActivity();
  },

  async loadActivity() {
    const container = document.getElementById('activity-timeline-container');
    if (container) {
      container.innerHTML = `
        <div class="tw-py-8 tw-text-center">
          <div class="tw-w-5 tw-h-5 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
          <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Loading audit trail...</span>
        </div>
      `;
    }

    try {
      const data = await ServerAPI.getActivity(this.serverId);
      if (!data.success) return;

      if (!data.activity || data.activity.length === 0) {
        container.innerHTML = `
          <div class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
            No activity logged for this server yet.
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="tw-space-y-4">
          ${data.activity.map(act => {
            const dateStr = new Date(act.created_at).toLocaleString();
            const actor = act.actor_name || 'System';

            return `
              <div class="kh-timeline-item tw-flex tw-gap-4 tw-p-4 tw-rounded-xl tw-bg-white/[0.02] tw-border tw-border-white/[0.06]">
                <div class="tw-mt-1">
                  <span class="tw-w-2 tw-h-2 tw-rounded-full tw-bg-white tw-block"></span>
                </div>
                <div class="tw-flex-1 tw-min-w-0">
                  <div class="tw-flex tw-items-center tw-justify-between tw-gap-2">
                    <span class="tw-font-mono tw-text-xs tw-font-semibold tw-text-white">${escapeHtml(act.action.toUpperCase())}</span>
                    <span class="tw-font-mono tw-text-[11px] tw-text-neutral-500">${dateStr}</span>
                  </div>
                  <div class="tw-text-xs tw-text-neutral-300 tw-mt-1">${escapeHtml(act.details || '')}</div>
                  <div class="tw-font-mono tw-text-[10px] tw-text-neutral-500 tw-mt-1.5">Triggered by: ${escapeHtml(actor)}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      if (container) container.innerHTML = `<div class="tw-p-4 tw-text-red-400 tw-text-xs">${escapeHtml(err.message)}</div>`;
    }
  },

  teardown() {
    this.serverId = null;
  }
};

window.ActivityTabController = ActivityTabController;
