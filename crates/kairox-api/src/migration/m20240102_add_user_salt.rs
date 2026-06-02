use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str { "m20240102_000001_add_user_salt" }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, mgr: &SchemaManager) -> Result<(), DbErr> {
        mgr.alter_table(
            Table::alter()
                .table(Users::Table)
                .add_column(ColumnDef::new(Users::Salt).binary().not_null().default(vec![0u8; 32]))
                .to_owned(),
        ).await
    }

    async fn down(&self, mgr: &SchemaManager) -> Result<(), DbErr> {
        mgr.alter_table(
            Table::alter()
                .table(Users::Table)
                .drop_column(Users::Salt)
                .to_owned(),
        ).await
    }
}

#[derive(Iden)]
enum Users { Table, Salt }
