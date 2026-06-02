use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str { "m20240101_000001_initial" }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, mgr: &SchemaManager) -> Result<(), DbErr> {
        mgr.create_table(
            Table::create()
                .table(Users::Table)
                .if_not_exists()
                .col(ColumnDef::new(Users::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Users::Email).string().not_null().unique_key())
                .col(ColumnDef::new(Users::AuthHash).string().not_null())
                .col(ColumnDef::new(Users::PublicKey).binary().not_null())
                .col(ColumnDef::new(Users::CreatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .col(ColumnDef::new(Users::UpdatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .to_owned(),
        ).await?;

        mgr.create_table(
            Table::create()
                .table(Collections::Table)
                .if_not_exists()
                .col(ColumnDef::new(Collections::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Collections::OwnerId).uuid().not_null())
                .col(ColumnDef::new(Collections::CreatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .col(ColumnDef::new(Collections::UpdatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .foreign_key(
                    ForeignKey::create()
                        .from(Collections::Table, Collections::OwnerId)
                        .to(Users::Table, Users::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        ).await?;

        mgr.create_table(
            Table::create()
                .table(WrappedKeys::Table)
                .if_not_exists()
                .col(ColumnDef::new(WrappedKeys::CollectionId).uuid().not_null())
                .col(ColumnDef::new(WrappedKeys::UserId).uuid().not_null())
                .col(ColumnDef::new(WrappedKeys::KeyVersion).integer().not_null().default(1))
                .col(ColumnDef::new(WrappedKeys::WrappedBytes).binary().not_null())
                .col(ColumnDef::new(WrappedKeys::CreatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .primary_key(Index::create().col(WrappedKeys::CollectionId).col(WrappedKeys::UserId))
                .foreign_key(
                    ForeignKey::create()
                        .from(WrappedKeys::Table, WrappedKeys::CollectionId)
                        .to(Collections::Table, Collections::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .from(WrappedKeys::Table, WrappedKeys::UserId)
                        .to(Users::Table, Users::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        ).await?;

        mgr.create_table(
            Table::create()
                .table(Entries::Table)
                .if_not_exists()
                .col(ColumnDef::new(Entries::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Entries::CollectionId).uuid().not_null())
                .col(ColumnDef::new(Entries::Version).integer().not_null().default(1))
                .col(ColumnDef::new(Entries::CreatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .col(ColumnDef::new(Entries::UpdatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                .col(ColumnDef::new(Entries::Ciphertext).binary().not_null())
                .foreign_key(
                    ForeignKey::create()
                        .from(Entries::Table, Entries::CollectionId)
                        .to(Collections::Table, Collections::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .to_owned(),
        ).await?;

        mgr.create_index(
            Index::create()
                .name("entries_collection_idx")
                .table(Entries::Table)
                .col(Entries::CollectionId)
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, mgr: &SchemaManager) -> Result<(), DbErr> {
        mgr.drop_table(Table::drop().table(Entries::Table).to_owned()).await?;
        mgr.drop_table(Table::drop().table(WrappedKeys::Table).to_owned()).await?;
        mgr.drop_table(Table::drop().table(Collections::Table).to_owned()).await?;
        mgr.drop_table(Table::drop().table(Users::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)] enum Users      { Table, Id, Email, AuthHash, PublicKey, CreatedAt, UpdatedAt }
#[derive(Iden)] enum Collections { Table, Id, OwnerId, CreatedAt, UpdatedAt }
#[derive(Iden)] enum WrappedKeys { Table, CollectionId, UserId, KeyVersion, WrappedBytes, CreatedAt }
#[derive(Iden)] enum Entries    { Table, Id, CollectionId, Version, CreatedAt, UpdatedAt, Ciphertext }
