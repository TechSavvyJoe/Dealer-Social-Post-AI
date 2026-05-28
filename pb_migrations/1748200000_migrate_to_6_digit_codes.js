migrate((db) => {
  // Migrate existing 4-digit dealer codes to 6-digits (append '00')
  const dealers = new Collection("dealers");
  
  // Find all dealers that have a 4-digit code
  const result = db.newQuery("SELECT id, code FROM dealers WHERE length(code) = 4").execute();
  
  for (let i = 0; i < result.length; i++) {
    const row = result[i];
    const newCode = row.code + "00";
    db.newQuery("UPDATE dealers SET code = {:code} WHERE id = {:id}")
      .bind({ code: newCode, id: row.id })
      .execute();
  }

  // Also migrate the admin_code from 4 to 6 digits if it exists
  const adminResult = db.newQuery("SELECT id, admin_code FROM dealers WHERE length(admin_code) = 4").execute();
  for (let i = 0; i < adminResult.length; i++) {
    const row = adminResult[i];
    const newAdminCode = row.admin_code + "00";
    db.newQuery("UPDATE dealers SET admin_code = {:admin_code} WHERE id = {:id}")
      .bind({ admin_code: newAdminCode, id: row.id })
      .execute();
  }

}, (db) => {
  // Revert: truncate 6-digit codes back to 4 digits (assuming they end in '00')
  const result = db.newQuery("SELECT id, code FROM dealers WHERE length(code) = 6 AND code LIKE '%00'").execute();
  for (let i = 0; i < result.length; i++) {
    const row = result[i];
    const oldCode = row.code.substring(0, 4);
    db.newQuery("UPDATE dealers SET code = {:code} WHERE id = {:id}")
      .bind({ code: oldCode, id: row.id })
      .execute();
  }

  const adminResult = db.newQuery("SELECT id, admin_code FROM dealers WHERE length(admin_code) = 6 AND admin_code LIKE '%00'").execute();
  for (let i = 0; i < adminResult.length; i++) {
    const row = adminResult[i];
    const oldAdminCode = row.admin_code.substring(0, 4);
    db.newQuery("UPDATE dealers SET admin_code = {:admin_code} WHERE id = {:id}")
      .bind({ admin_code: oldAdminCode, id: row.id })
      .execute();
  }
});
