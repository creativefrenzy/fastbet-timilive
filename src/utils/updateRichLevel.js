import pool from "../db.js";

/**
 * Update rich level for a user based on redeem_point and rich_levels table.
 * @param {number} userId
 */
export async function updateRichLevel(userId) {
  let conn;

  try {
    conn = await pool.getConnection();

    // Get current redeem_point
    const [redeemRows] = await conn.execute(
      `SELECT id, redeem_point FROM users WHERE id = ? ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    const current = redeemRows[0];
    if (!current) return null;

    const redeemPoint = Number(current.redeem_point || 0);

    // Get highest rich_levels where amount <= redeem_point
    const [prevLevelRows] = await conn.execute(
      `SELECT id, level, amount
         FROM rich_levels
        WHERE amount <= ?
        ORDER BY level DESC
        LIMIT 1`,
      [redeemPoint]
    );

    // Get lowest rich_levels where amount >= redeem_point
    const [nextLevelRows] = await conn.execute(
      `SELECT id, level
         FROM rich_levels
        WHERE amount >= ?
        ORDER BY level ASC
        LIMIT 1`,
      [redeemPoint]
    );

    const prevLevel = prevLevelRows?.[0] || null;
    const nextLevel = nextLevelRows?.[0] || null;

    // Decide m_level
    let m_level = 0;
    if (prevLevel && redeemPoint > Number(prevLevel.amount || 0)) {
      m_level = Number(prevLevel.level || 0);
    } else if (nextLevel) {
      m_level = Number(nextLevel.level || 0);
    }

    // Fetch user data
    const [userRows] = await conn.execute(
      `SELECT id, gender, rich_level FROM users WHERE id = ?`,
      [userId]
    );
    const user = userRows[0];
    if (!user) return null;

    const currentRich = Number(user.rich_level || 0);

    // Determine new_level
    const newLevel = currentRich > m_level ? currentRich : m_level;

    // Update users (and females if needed)
    await conn.execute(
      `UPDATE users SET rich_level = ? WHERE id = ?`,
      [newLevel, userId]
    );

    if (user.gender && user.gender.toLowerCase() !== "male") {
      // assume females table has user with same id
      await conn.execute(
        `UPDATE females SET rich_level = ? WHERE id = ?`,
        [newLevel, userId]
      );
    }

    return { userId, newLevel };
  } catch (err) {
    console.error("updateRichLevel error:", err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}
