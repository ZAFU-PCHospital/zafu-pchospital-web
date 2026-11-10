/**
 * 收藏、案例标记与审核通知文案
 *
 * 页面与组件不得硬编码展示文案。未接入的能力（排行）仍走 memberCopy 的「尚未接入」。
 */

export const communityCopy = {
  common: {
    dismiss: "关闭提示",
  },
  pagination: {
    previous: "上一页",
    next: "下一页",
  },
  favorite: {
    add: "收藏",
    remove: "取消收藏",
    adding: "正在收藏…",
    removing: "正在取消…",
  },
  flags: {
    difficult: "疑难案例",
    typical: "典型案例",
    save: "保存标记",
    saving: "正在保存…",
    saved: "案例标记已更新",
    saveFailed: "案例标记保存失败",
  },
  notifications: {
    title: "消息通知",
    label: "Notifications",
    empty: "暂时没有通知",
    unreadEmpty: "没有未读通知",
    readEmpty: "没有已读通知",
    loading: "正在加载通知…",
    loadError: "通知加载失败，请稍后重试",
    reload: "重新加载",
    markRead: "标为已读",
    markAllRead: "全部标为已读",
    marking: "正在更新…",
    markReadFailed: "标为已读失败，请稍后重试",
    markAllFailed: "全部标为已读失败，请稍后重试",
    deleteFailed: "删除通知失败，请稍后重试",
    delete: "删除",
    filterAll: "全部",
    filterUnread: "未读",
    filterRead: "已读",
    unreadCount: "未读 {count} 条",
    types: {
      REPAIR_APPROVED: "你的维修记录已通过审核",
      REPAIR_REJECTED: "你的维修记录被退回",
    } as Record<string, string>,
  },
  favorites: {
    title: "收藏",
    label: "Favorites",
    empty: "还没有收藏任何维修记录",
    loading: "正在加载收藏…",
    loadError: "收藏加载失败，请稍后重试",
    reload: "重新加载",
    count: "共 {count} 条",
    open: "查看记录",
    remove: "取消收藏",
    removeFailed: "取消收藏失败，请稍后重试",
    browseRepairs: "去看维修记录",
  },
} as const;
