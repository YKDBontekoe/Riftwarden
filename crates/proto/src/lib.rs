//! Wire types generated from `proto/riftwarden/v1` (see docs/architecture-v2.md section 5).

#![allow(clippy::all)]

pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/riftwarden.v1.rs"));
}

#[cfg(test)]
mod tests {
    use prost::Message;

    use super::v1::*;

    #[test]
    fn client_frame_round_trips() {
        let frame = ClientFrame { msg: Some(client_frame::Msg::Ping(Ping { c: 12.5 })) };
        let bytes = frame.encode_to_vec();
        assert_eq!(ClientFrame::decode(bytes.as_slice()).unwrap(), frame);
    }

    #[test]
    fn snapshot_rows_are_compact() {
        let row = EnemyRow { id: 7, x_cm: 2512, y_cm: 0, z_cm: -4011, yaw_mrad: 1571, hp: 120, max_hp: 120, ..Default::default() };
        // Quantised rows stay small: the old JSON row was ~80 bytes.
        assert!(row.encoded_len() < 24, "{}", row.encoded_len());
    }
}
