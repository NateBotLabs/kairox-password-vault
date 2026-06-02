use sea_orm_migration::prelude::*;

mod m20240101_initial;
mod m20240102_add_user_salt;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20240101_initial::Migration),
            Box::new(m20240102_add_user_salt::Migration),
        ]
    }
}
