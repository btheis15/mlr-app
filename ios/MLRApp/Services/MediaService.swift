import Foundation
import UIKit
import Supabase

// MARK: - MediaService

/// Handles image resizing, upload to Supabase Storage, and profile avatar updates.
/// Not @Observable — all methods are fire-and-return async throws.
final class MediaService {

    // MARK: - Post images

    /// Resize to max 1920 px on the longest side, compress to JPEG 0.8,
    /// upload to "post-photos/<userId>/<uuid>.jpg", return the public URL.
    func uploadPostImage(image: UIImage, userId: UUID) async throws -> String {
        let resized = resize(image: image, maxDimension: 1920)
        guard let data = resized.jpegData(compressionQuality: 0.8) else {
            throw MediaError.encodingFailed
        }
        let path = "\(userId.uuidString)/\(UUID().uuidString).jpg"
        _ = try await supabase.storage
            .from("post-photos")
            .upload(path, data: data, options: FileOptions(contentType: "image/jpeg"))

        return publicURL(bucket: "post-photos", path: path)
    }

    // MARK: - Avatars

    /// Resize to 400×400, upload to "avatars/<userId>.jpg",
    /// update profiles.avatar_url, return the public URL.
    func uploadAvatar(image: UIImage, userId: UUID) async throws -> String {
        let resized = resizeSquare(image: image, side: 400)
        guard let data = resized.jpegData(compressionQuality: 0.85) else {
            throw MediaError.encodingFailed
        }
        let path = "\(userId.uuidString).jpg"
        _ = try await supabase.storage
            .from("avatars")
            .upload(
                path,
                data: data,
                options: FileOptions(
                    contentType: "image/jpeg",
                    upsert: true           // overwrite the previous avatar
                )
            )

        let url = publicURL(bucket: "avatars", path: path)

        // Persist the new URL on the profile row
        try await supabase
            .from("profiles")
            .update(["avatar_url": url])
            .eq("id", value: userId.uuidString)
            .execute()

        return url
    }

    // MARK: - Delete

    /// Parse the bucket and path from a Supabase Storage public URL and remove the object.
    func deleteMedia(url: String) async throws {
        guard let (bucket, path) = parseBucketAndPath(from: url) else {
            throw MediaError.invalidURL
        }
        try await supabase.storage
            .from(bucket)
            .remove(paths: [path])
    }

    // MARK: - Image helpers

    private func resize(image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return image }
        let scale = maxDimension / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        return redraw(image: image, to: newSize)
    }

    private func resizeSquare(image: UIImage, side: CGFloat) -> UIImage {
        // First crop to square using the shorter dimension, then scale.
        let size = image.size
        let shortest = min(size.width, size.height)
        let cropRect = CGRect(
            x: (size.width  - shortest) / 2,
            y: (size.height - shortest) / 2,
            width: shortest,
            height: shortest
        )
        // Crop
        let cropped: UIImage
        if let cgCrop = image.cgImage?.cropping(to: cropRect.applying(
            CGAffineTransform(scaleX: image.scale, y: image.scale)
        )) {
            cropped = UIImage(cgImage: cgCrop, scale: image.scale, orientation: image.imageOrientation)
        } else {
            cropped = image
        }
        return redraw(image: cropped, to: CGSize(width: side, height: side))
    }

    private func redraw(image: UIImage, to size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: - URL helpers

    /// Build the public URL from the Supabase project URL + bucket + path.
    private func publicURL(bucket: String, path: String) -> String {
        // supabase global client URL is the project root; append /storage/v1/object/public/…
        let base = supabase.supabaseURL.absoluteString
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return "\(base)/storage/v1/object/public/\(bucket)/\(path)"
    }

    /// Extract bucket and object path from a Supabase Storage public URL.
    /// URL pattern: …/storage/v1/object/public/<bucket>/<path>
    private func parseBucketAndPath(from urlString: String) -> (bucket: String, path: String)? {
        guard let url = URL(string: urlString) else { return nil }
        let components = url.pathComponents
        // Find "public" marker in path
        guard let publicIdx = components.firstIndex(of: "public"),
              components.count > publicIdx + 2
        else { return nil }
        let bucket = components[publicIdx + 1]
        let path   = components[(publicIdx + 2)...].joined(separator: "/")
        return (bucket, path)
    }
}

// MARK: - Errors

enum MediaError: LocalizedError {
    case encodingFailed
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .encodingFailed: return "Couldn't process the image. Please try a different photo."
        case .invalidURL:     return "The media URL is not a valid Supabase Storage URL."
        }
    }
}
