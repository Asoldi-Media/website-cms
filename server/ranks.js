/** Staff ranks. employee cannot delete users, writer is blog-only, member has no modules. */
const RANKS = ['admin', 'employee', 'writer', 'member'];
const STAFF_RANKS = ['employee', 'writer', 'member'];
/** employee, writer, member, or admin. Unknown values use the fallback. */
export function normalizeRank(value, fallback = 'employee') {
    const rank = String(value || '').trim().toLowerCase();
    if (RANKS.includes(rank))
        return rank;
    return STAFF_RANKS.includes(fallback) ? fallback : 'employee';
}
/** User fields safe to send to the admin UI. No password hash. */
export function publicUser(user) {
    if (!user)
        return null;
    return {
        id: user.id,
        username: user.username,
        name: user.name || '',
        email: user.email || '',
        avatarUrl: user.avatarUrl || '',
        rank: normalizeRank(user.rank),
        createdAt: user.createdAt,
    };
}
/** Whether a rank may open that admin tab. */
export function canAccessTab(rank, tab) {
    const resolved = normalizeRank(rank, 'member');
    if (resolved === 'admin')
        return true;
    if (resolved === 'member')
        return false;
    if (resolved === 'writer')
        return tab === 'blog';
    return tab !== 'delete-users';
}
/** True only for admin. */
export function canDeleteUsers(rank) {
    return normalizeRank(rank, 'member') === 'admin';
}
export { RANKS, STAFF_RANKS };
