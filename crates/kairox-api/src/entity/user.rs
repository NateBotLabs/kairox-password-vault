use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub email: String,
    pub auth_hash: String,
    pub public_key: Vec<u8>,
    /// Random 32-byte Argon2 salt. Not secret — returned to clients who need to re-derive keys.
    pub salt: Vec<u8>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::collection::Entity")]
    Collection,
    #[sea_orm(has_many = "super::wrapped_key::Entity")]
    WrappedKey,
}

impl Related<super::collection::Entity> for Entity {
    fn to() -> RelationDef { Relation::Collection.def() }
}

impl Related<super::wrapped_key::Entity> for Entity {
    fn to() -> RelationDef { Relation::WrappedKey.def() }
}

impl ActiveModelBehavior for ActiveModel {}
