import AppIntents
import WidgetKit
import Foundation

// Danh sách trip do app ghi vào App Group (widget_trips.json) — nguồn cho picker.
struct WidgetTripListItem: Codable {
    let id: String
    let name: String
    let emoji: String
}

private let intentAppGroupID = "group.com.webcashglobal.tripmemo"

private func loadWidgetTripList() -> [WidgetTripListItem] {
    guard let url = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: intentAppGroupID)?
        .appendingPathComponent("widget_trips.json"),
          let data = try? Data(contentsOf: url),
          let list = try? JSONDecoder().decode([WidgetTripListItem].self, from: data)
    else { return [] }
    return list
}

// Một chuyến đi trong picker cấu hình widget.
struct TripEntity: AppEntity {
    let id: String
    let name: String
    let emoji: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Chuyến đi"
    static var defaultQuery = TripEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(emoji) \(name)")
    }
}

struct TripEntityQuery: EntityQuery {
    // Resolve lựa chọn đã lưu theo id. Trip đã xoá → không còn trong danh sách →
    // trả rỗng → iOS coi lựa chọn không hợp lệ → widget hiện "Chưa chọn chuyến đi".
    func entities(for identifiers: [String]) async throws -> [TripEntity] {
        let all = loadWidgetTripList()
        return identifiers.compactMap { id in
            all.first(where: { $0.id == id })
                .map { TripEntity(id: $0.id, name: $0.name, emoji: $0.emoji) }
        }
    }

    // Các trip hiện trong danh sách chọn.
    func suggestedEntities() async throws -> [TripEntity] {
        loadWidgetTripList().map { TripEntity(id: $0.id, name: $0.name, emoji: $0.emoji) }
    }
}

// Cấu hình widget: chọn 1 chuyến đi để hiển thị.
struct SelectTripIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Chọn chuyến đi"
    static var description = IntentDescription("Chọn chuyến đi hiển thị trên widget.")

    @Parameter(title: "Chuyến đi")
    var trip: TripEntity?

    init() {}
    init(trip: TripEntity?) { self.trip = trip }
}
