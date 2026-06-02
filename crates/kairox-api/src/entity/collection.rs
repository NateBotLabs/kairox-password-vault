use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "collections")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub owner_id: Uuid,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::OwnerId",
        to = "super::user::Column::Id"
    )]
    User,
    #[sea_orm(has_many = "super::wrapped_key::Entity")]
    WrappedKey,
    #[sea_orm(has_many = "super::entry::Entity")]
    Entry,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef { Relation::User.def() }
}

impl Related<super::wrapped_key::Entity> for Entity {
    fn to() -> RelationDef { Relation::WrappedKey.def() }
}

impl Related<super::entry::Entity> for Entity {
    fn to() -> RelationDef { Relation::Entry.def() }
}

impl ActiveModelBehavior for ActiveModel {}
